import pino from "pino";
import type { Logger, LoggerOptions } from "pino";
import { pinoHttp } from "pino-http";
import {
  HTTP_LOG_REDACT_PATHS,
  HEADER_REDACTION_MARKER,
  redactCredentialFields,
  redactSensitiveHeaders,
  sanitizeCredentialText,
  sanitizeErrorObject,
} from "./http-log-redaction.js";
import {
  isPrivateWebhookHttpRequest,
  isSecretSensitiveHttpRequest,
  shouldSilenceHttpSuccessLog,
} from "./http-log-policy.js";
import {
  redactSensitive,
  stripSecretBearingUrlParts,
} from "./redact-sensitive.js";

const sharedOpts = {
  translateTime: "SYS:HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};

/**
 * Serializes an error for a log record. `pino.stdSerializers.err` runs first so
 * the non-enumerable `Error.cause` chain is folded into `message` and `stack`,
 * and the sanitizer then strips credential material from that output.
 */
export function serializeLoggedError(err: unknown): unknown {
  return sanitizeErrorObject(pino.stdSerializers.err(err as Error));
}

/**
 * The redaction configuration shared by every logger this module exports.
 *
 * A credential-bearing name is removed wherever it can appear in a record:
 * - at the top level of any record or child binding, by `redact` (pino applies
 *   the same stringifiers to `child()` bindings);
 * - inside `req.headers` / `res.headers`, by `redact` and the HTTP serializers,
 *   which also catch credential-shaped names that are not on the known list;
 * - inside a `headers` field, by `serializers.headers`;
 * - inside merge objects and child bindings, by `redactCredentialFields`;
 *   subtrees beyond its inspection limit are replaced with a redaction marker;
 * - anywhere inside `reqBody` / `reqParams` / `errorContext` on a failed HTTP
 *   record, by `redactSensitive` in `customProps`;
 * - in `err`, by the serializer, including the cause chain.
 *
 * `logMethod` guards live objects before pino serializes them and strips
 * credential text from messages. `streamWrite` applies the same field policy
 * to the final JSON, including bindings that bypass `logMethod`. Unchanged
 * records retain their original serialization; malformed output becomes a
 * content-free diagnostic. Both production and pretty transports receive only
 * the sanitized stream.
 */
export const basePinoOptions = {
  redact: {
    paths: [...HTTP_LOG_REDACT_PATHS],
    censor: HEADER_REDACTION_MARKER,
  },
  serializers: {
    headers: (h: unknown) =>
      h && typeof h === "object"
        ? redactSensitiveHeaders(h as Record<string, unknown>)
        : h,
    err: serializeLoggedError,
  },
  hooks: {
    streamWrite(serialized: string) {
      try {
        const record: unknown = JSON.parse(serialized);
        const safe = redactCredentialFields(record);
        return safe === record ? serialized : `${JSON.stringify(safe)}\n`;
      } catch {
        return '{"level":50,"msg":"Log record could not be safely redacted"}\n';
      }
    },
    logMethod(this: unknown, inputArgs: unknown[], method: any) {
      // Neither rewrite throws: `redactCredentialFields` marks the fields it
      // cannot read and keeps redacting the rest of the record.
      for (let index = 0; index < inputArgs.length; index += 1) {
        const arg = inputArgs[index];
        const safe =
          typeof arg === "string"
            ? sanitizeCredentialText(arg)
            : redactCredentialFields(arg);
        if (safe !== arg) inputArgs[index] = safe;
      }
      return method.apply(this, inputArgs);
    },
  },
} satisfies LoggerOptions;

const isProduction = process.env.NODE_ENV === "production";
export const logger: Logger = isProduction
  ? pino({
      level: process.env.PAPERCLIP_LOG_LEVEL?.trim() || "info",
      ...basePinoOptions,
    })
  : pino(
      {
        level: process.env.PAPERCLIP_LOG_LEVEL?.trim() || "debug",
        ...basePinoOptions,
      },
      pino.transport({
        target: "pino-pretty",
        options: {
          ...sharedOpts,
          ignore: "pid,hostname,req,res,responseTime",
          colorize: true,
          destination: 1,
        },
      }),
    );

function requestClassificationUrl(req: {
  originalUrl?: unknown;
  url?: unknown;
}): string | undefined {
  return typeof req.originalUrl === "string"
    ? req.originalUrl
    : typeof req.url === "string"
      ? req.url
      : undefined;
}

function isPrivateWebhook(req: {
  method?: string;
  originalUrl?: unknown;
  url?: unknown;
}) {
  return isPrivateWebhookHttpRequest(
    req.method,
    requestClassificationUrl(req),
  );
}

function privateWebhookLogUrl(url: unknown) {
  return typeof url === "string" && /\/routine-triggers\/public(?:\/|$)/i.test(url)
    ? "/api/routine-triggers/public/:publicId/fire"
    : "/api/chat-webhooks/:publicId/:provider";
}

function requestLogUrl(req: {
  method?: string;
  originalUrl?: unknown;
  url?: unknown;
}) {
  return isPrivateWebhook(req)
    ? privateWebhookLogUrl(requestClassificationUrl(req))
    : stripSecretBearingUrlParts(typeof req.url === "string" ? req.url : "");
}

export function createHttpLogger(baseLogger: Logger) {
  return pinoHttp({
    logger: baseLogger,
    serializers: {
      // pino-http wraps a custom `err` serializer with `pino.stdSerializers.err`,
      // so this receives the standard projection (cause chain already folded
      // into `message` and `stack`) and only has to sanitize it.
      err: sanitizeErrorObject,
      req(req: Record<string, unknown> & { url?: unknown; headers?: unknown }) {
        if (
          isPrivateWebhook({
            method: typeof req.method === "string" ? req.method : undefined,
            url: req.url,
          })
        ) {
          // pino's standard request serializer has already selected originalUrl.
          // A closed projection also excludes params, arbitrary headers and any
          // parser/SDK-added body copies, including Buffer numeric byte keys.
          return {
            id: req.id,
            method: req.method,
            url: privateWebhookLogUrl(req.url),
          };
        }
        const headers =
          req.headers && typeof req.headers === "object"
            ? redactSensitiveHeaders(req.headers as Record<string, unknown>)
            : req.headers;
        return {
          ...req,
          url:
            typeof req.url === "string"
              ? stripSecretBearingUrlParts(req.url)
              : req.url,
          headers,
          // The URL policy intentionally drops all query parameters. The default
          // serializer also exposes the parsed query separately, so omit that
          // duplicate path instead of letting credentials bypass the URL scrub.
          query: undefined,
        };
      },
      res(
        res: Record<string, unknown> & {
          headers?: unknown;
          raw?: {
            req?: { method?: string; originalUrl?: unknown; url?: unknown };
          };
        },
      ) {
        // A provider error may also be reflected in response headers. Keep the
        // same content-free contract on both sides of a webhook request.
        if (res.raw?.req && isPrivateWebhook(res.raw.req)) {
          return { statusCode: res.statusCode };
        }
        if (res.headers && typeof res.headers === "object") {
          return {
            ...res,
            headers: redactSensitiveHeaders(
              res.headers as Record<string, unknown>,
            ),
          };
        }
        return res;
      },
    },
    customLogLevel(_req, res, err) {
      if (shouldSilenceHttpSuccessLog(_req.method, _req.url, res.statusCode)) {
        return "silent";
      }
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${requestLogUrl(req)} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      if (
        isSecretSensitiveHttpRequest(req.method, requestClassificationUrl(req))
      ) {
        return `${req.method} ${requestLogUrl(req)} ${res.statusCode} — request failed`;
      }
      const ctx = (res as any).__errorContext;
      // `hooks.logMethod` sanitizes credential material out of this message
      // before it is written, so there is one scrubbing path, not two.
      const errMsg =
        ctx?.error?.message ||
        err?.message ||
        (res as any).err?.message ||
        "unknown error";
      return `${req.method} ${stripSecretBearingUrlParts(req.url ?? "")} ${res.statusCode} — ${errMsg}`;
    },
    customErrorObject(req, _res, _err, value) {
      // pino-http serializes res.err independently of customProps/errorContext.
      // Do not rely on a particular error handler having sanitized an SDK Error.
      return isPrivateWebhook(req)
        ? {
            ...value,
            err: { type: "Error", message: "Chat webhook request failed" },
          }
        : value;
    },
    customProps(req, res) {
      if (res.statusCode >= 400) {
        const ctx = (res as any).__errorContext;
        if (isPrivateWebhook(req)) {
          // Omit, rather than recursively redact, the entire provider payload.
          // This applies equally before/after parsing and with/without context.
          return {
            reqBody: "[REDACTED]",
            ...(ctx || (res as any).err
              ? { errorContext: { name: "Error" } }
              : {}),
          };
        }
        if (ctx) {
          const secretSensitiveRoute = isSecretSensitiveHttpRequest(
            req.method,
            requestClassificationUrl(req),
          );
          return {
            // Provider SDK and validation errors sometimes echo the supplied
            // credential in their prose. Keep only a non-sensitive type marker
            // for setup routes; the status, route, and redacted body remain.
            errorContext: secretSensitiveRoute
              ? { name: "Error" }
              : redactSensitive(ctx.error),
            reqBody: redactSensitive(ctx.reqBody),
            reqParams: redactSensitive(ctx.reqParams),
          };
        }
        const props: Record<string, unknown> = {};
        const { body, params } = req as any;
        if (body && typeof body === "object" && Object.keys(body).length > 0) {
          props.reqBody = redactSensitive(body);
        }
        if (
          params &&
          typeof params === "object" &&
          Object.keys(params).length > 0
        ) {
          props.reqParams = redactSensitive(params);
        }
        if ((req as any).route?.path) {
          props.routePath = (req as any).route.path;
        }
        return props;
      }
      return {};
    },
  });
}

export const httpLogger = createHttpLogger(logger);

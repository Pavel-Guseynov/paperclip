import pino from "pino";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import {
  HTTP_LOG_REDACT_PATHS,
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

export function wrapLoggerWithRedaction(log: Logger): Logger {
  const originalChild = log.child.bind(log);
  (log as any).child = function (bindings: any, options?: any) {
    const sanitizedBindings = redactSensitive(bindings) as Record<
      string,
      unknown
    >;
    const childLogger = originalChild(sanitizedBindings, options);
    return wrapLoggerWithRedaction(childLogger);
  };
  return log;
}

const basePinoOptions = {
  redact: [...HTTP_LOG_REDACT_PATHS],
  serializers: {
    headers: (h: unknown) =>
      h && typeof h === "object"
        ? redactSensitiveHeaders(h as Record<string, unknown>)
        : h,
    err: (e: unknown) => sanitizeErrorObject(e),
  },
  hooks: {
    logMethod(inputArgs: unknown[], method: any) {
      const sanitizedArgs = inputArgs.map((arg) => {
        if (arg instanceof Error) {
          return sanitizeErrorObject(arg);
        }
        if (typeof arg === "string") {
          return sanitizeCredentialText(arg);
        }
        if (arg && typeof arg === "object") {
          return redactSensitive(arg);
        }
        return arg;
      });
      return method.apply(this, sanitizedArgs);
    },
  },
};

const isProduction = process.env.NODE_ENV === "production";
const rawLogger = isProduction
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

export const logger = wrapLoggerWithRedaction(rawLogger);

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
      const rawErrMsg =
        ctx?.error?.message ||
        err?.message ||
        (res as any).err?.message ||
        "unknown error";
      const errMsg = sanitizeCredentialText(rawErrMsg);
      const safeUrl = requestLogUrl(req);
      return `${req.method} ${safeUrl} ${res.statusCode} — ${errMsg}`;
    },
    customErrorObject(req, _res, err, value) {
      // pino-http serializes res.err independently of customProps/errorContext.
      // Do not rely on a particular error handler having sanitized an SDK Error.
      if (isPrivateWebhook(req)) {
        return {
          ...value,
          err: { type: "Error", message: "Chat webhook request failed" },
        };
      }
      const rawError = (value as any)?.err ?? err;
      if (rawError) {
        return {
          ...value,
          err: sanitizeErrorObject(rawError),
        };
      }
      return value;
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

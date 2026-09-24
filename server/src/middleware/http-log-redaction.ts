import { IncomingMessage, ServerResponse } from "node:http";

/**
 * The two redaction markers, each defined exactly once here and imported by
 * every redactor. `HEADER_REDACTION_MARKER` is pino's own `redact` censor and
 * marks a header or field removed by name; `VALUE_REDACTION_MARKER` is what
 * the recursive value redactor writes in place of a credential value.
 */
export const HEADER_REDACTION_MARKER = "[Redacted]";
export const VALUE_REDACTION_MARKER = "[REDACTED]";

/**
 * The single source of truth for header names whose value is authentication
 * material. `HTTP_LOG_REDACT_PATHS` is derived from this list and
 * `isCredentialBearingHeader` treats every entry as sensitive, so the pino
 * redact paths and the runtime header check can never drift apart.
 */
export const CREDENTIAL_HEADER_NAMES = [
  "authorization",
  "proxy-authorization",
  "cookie",
  // "set-cookie" is normally a response header; the derived request-side path
  // is defensive coverage in case a proxy forwards it inbound.
  "set-cookie",
  // Credential- and session-paired headers with no debugging value.
  "x-csrf-token",
  "x-xsrf-token",
  "x-api-key",
  // Runtime GitHub capabilities authorize credential acquisition for a live run.
  "x-paperclip-github-capability",
  // Telegram's optional webhook verification header is a reusable bearer
  // secret sent on every provider callback.
  "x-telegram-bot-api-secret-token",
  // The MCP tool gateway's session and connection tokens (`pcgt_`/`pcgw_`).
  "x-paperclip-tool-gateway-token",
  // The dev-server status token unlocks full health detail.
  "x-paperclip-dev-server-status-token",
  // Cloud runtime identity and control headers authenticate the caller.
  "x-paperclip-cloud-runtime-identity",
  "x-paperclip-cloud-control",
  // The generic routine-trigger HMAC signature.
  "x-paperclip-signature",
] as const;

/**
 * Credential fields that structured records and child-logger bindings carry at
 * the top level instead of inside a `headers` object.
 */
export const CREDENTIAL_LOG_FIELD_NAMES = [
  "gatewayToken",
  "gateway_token",
  "toolGatewayToken",
  "tool_gateway_token",
  "sessionToken",
  "session_token",
] as const;

/** Renders one pino redact path, using dot notation when the name allows it. */
function redactPath(container: string, name: string): string {
  const segment = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? container === ""
      ? name
      : `.${name}`
    : `["${name}"]`;
  return `${container}${segment}`;
}

export const HTTP_LOG_REDACT_PATHS: readonly string[] = [
  // Request and response header objects produced by pino's HTTP serializers.
  ...CREDENTIAL_HEADER_NAMES.flatMap((name) => [
    redactPath("req.headers", name),
    redactPath("res.headers", name),
  ]),
  // The same names bound directly onto a record or a child logger.
  ...CREDENTIAL_HEADER_NAMES.map((name) => redactPath("", name)),
  ...CREDENTIAL_LOG_FIELD_NAMES.map((name) => redactPath("", name)),
  // The structured failure logger adds a sanitized request-body copy under
  // `reqBody`. Keep the standard connector credential envelope covered again
  // at the final serialization boundary in case a future custom serializer
  // bypasses the recursive redactor.
  "reqBody.credentials",
  "errorContext.details.credentials",
];

/** Returns true if the object is an HTTP IncomingMessage, ServerResponse, or request/response mock. */
export function isHttpObject(val: unknown): boolean {
  if (!val || typeof val !== "object") return false;
  if (val instanceof IncomingMessage || val instanceof ServerResponse) {
    return true;
  }
  const v = val as any;
  if (typeof v.setHeader === "function" && typeof v.end === "function") {
    return true;
  }
  if (
    typeof v.pipe === "function" &&
    (v.headers || v.socket || v._readableState)
  ) {
    return true;
  }
  return false;
}

const KNOWN_SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set(
  CREDENTIAL_HEADER_NAMES,
);

const CREDENTIAL_HEADER_PATTERN =
  /(^|[-_])(authorization|cookie|secret|session[-_]?token|auth[-_]?token|token|capability|signature|credential)([-_]|$)|(^|[-_])api[-_]?key([-_]|$)/i;

/** Returns true if the header name represents an authentication or credential value. */
export function isCredentialBearingHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (KNOWN_SENSITIVE_HEADER_NAMES.has(normalized)) return true;
  return CREDENTIAL_HEADER_PATTERN.test(normalized);
}

/** Redacts credential-bearing headers regardless of letter casing. */
export function redactSensitiveHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isCredentialBearingHeader(key) ? HEADER_REDACTION_MARKER : value;
  }
  return out;
}

// An HTTP auth scheme followed by a placeholder (`<token>`, `[REDACTED]`) or an
// opaque credential. `.` only joins segments, so trailing sentence punctuation
// is never consumed.
const AUTH_SCHEME_PATTERN =
  /\b(Bearer|Basic|Digest)(\s+)(<[^>\s]*>|\[[^\]\s]*\]|[A-Za-z0-9_~+/=-]+(?:\.[A-Za-z0-9_~+/=-]+)*)/gi;

// Minted gateway credentials are `pcgt_<session uuid>.<secret>` and
// `pcgw_<token uuid>.<secret>`. The dot-separated secret is required so the
// deliberate `pcgw_<first 8 chars>` diagnostic fingerprint survives.
const GATEWAY_TOKEN_PATTERN = /\bpcg[wt]_[A-Za-z0-9-]+\.[A-Za-z0-9_-]{8,}/g;

const URL_CREDENTIAL_QUERY_PATTERN =
  /([?&](?:token|sessionToken|gatewayToken|gateway_token|toolGatewayToken|tool_gateway_token|x-paperclip-tool-gateway-token|access_token|refresh_token|secret|api_key)=)[^&#\s]+/gi;

/**
 * Returns true when an `Authorization`-style value is credential material
 * rather than documentation prose. A placeholder (`<token>`, `[REDACTED]`) and
 * a short all-lowercase word ("token", "authorization", "header") are prose;
 * anything with mixed case, digits, separators, or real token length is not.
 */
function isCredentialLikeAuthValue(value: string): boolean {
  if (/^<[^>]*>$/.test(value) || /^\[[^\]]*\]$/.test(value)) return false;
  if (/^[a-z]+$/.test(value) && value.length < 20) return false;
  return true;
}

/** Strips auth-scheme secrets, Paperclip gateway tokens, and query credentials from arbitrary prose or error messages. */
export function sanitizeCredentialText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    .replace(AUTH_SCHEME_PATTERN, (match, scheme, gap, value: string) =>
      isCredentialLikeAuthValue(value)
        ? `${scheme}${gap}${VALUE_REDACTION_MARKER}`
        : match,
    )
    .replace(GATEWAY_TOKEN_PATTERN, VALUE_REDACTION_MARKER)
    .replace(URL_CREDENTIAL_QUERY_PATTERN, `$1${VALUE_REDACTION_MARKER}`);
}

/**
 * Sanitizes an error's message, stack, and attached custom properties.
 * Callers that log a live `Error` pass it through `pino.stdSerializers.err`
 * first so the cause chain is folded into the message and stack.
 */
export function sanitizeErrorObject(err: unknown): unknown {
  if (!err || typeof err !== "object") {
    return typeof err === "string" ? sanitizeCredentialText(err) : err;
  }
  const error = err as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (err instanceof Error) {
    out.type = error.name || "Error";
    out.message =
      typeof err.message === "string"
        ? sanitizeCredentialText(err.message)
        : err.message;
    if (typeof err.stack === "string") {
      out.stack = sanitizeCredentialText(err.stack);
    }
  } else {
    if ("type" in error && typeof error.type === "string") {
      out.type = error.type;
    } else if ("name" in error && typeof error.name === "string") {
      out.type = error.name;
    }
    if ("message" in error && typeof error.message === "string") {
      out.message = sanitizeCredentialText(error.message);
    }
    if ("stack" in error && typeof error.stack === "string") {
      out.stack = sanitizeCredentialText(error.stack);
    }
  }

  for (const [key, value] of Object.entries(error)) {
    if (
      key === "message" ||
      key === "stack" ||
      key === "type" ||
      key === "name"
    ) {
      continue;
    }
    if (isCredentialBearingHeader(key)) {
      out[key] = VALUE_REDACTION_MARKER;
    } else if (typeof value === "string") {
      out[key] = sanitizeCredentialText(value);
    } else if (value && typeof value === "object") {
      out[key] = sanitizeErrorObject(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

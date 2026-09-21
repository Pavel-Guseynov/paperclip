export const HTTP_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  'req.headers["proxy-authorization"]',
  "req.headers.cookie",
  // "set-cookie" is normally a response header; keep the request-side
  // path as defensive coverage in case a proxy forwards it inbound.
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  // Credential- and session-paired headers with no debugging value.
  'req.headers["x-csrf-token"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-api-key"]',
  // Telegram's optional webhook verification header is a reusable bearer
  // secret sent on every provider callback.
  'req.headers["x-telegram-bot-api-secret-token"]',
  // Gateway and runtime capability credential headers.
  'req.headers["x-paperclip-tool-gateway-token"]',
  'res.headers["x-paperclip-tool-gateway-token"]',
  'req.headers["x-paperclip-github-capability"]',
  'res.headers["x-paperclip-github-capability"]',
  'req.headers["x-paperclip-dev-server-status-token"]',
  'req.headers["x-paperclip-cloud-runtime-identity"]',
  'req.headers["x-paperclip-cloud-control"]',
  'req.headers["x-paperclip-signature"]',
  // Structured records and child loggers that log isolated `headers` objects.
  'headers["x-paperclip-tool-gateway-token"]',
  'headers["x-paperclip-github-capability"]',
  'headers["x-paperclip-dev-server-status-token"]',
  'headers["x-paperclip-cloud-runtime-identity"]',
  'headers["x-paperclip-cloud-control"]',
  'headers["x-paperclip-signature"]',
  "headers.authorization",
  'headers["proxy-authorization"]',
  // Direct gateway token bindings in child loggers or custom records.
  "gatewayToken",
  "gateway_token",
  "toolGatewayToken",
  "sessionToken",
  "session_token",
  // The structured failure logger adds a sanitized request-body copy under
  // `reqBody`. Keep the standard connector credential envelope covered again
  // at the final serialization boundary in case a future custom serializer
  // bypasses the recursive redactor.
  "reqBody.credentials",
  "errorContext.details.credentials",
] as const;

const SAFE_DIAGNOSTIC_HEADER_NAMES = new Set([
  "x-paperclip-run-id",
  "x-paperclip-client-name",
  "x-paperclip-bridge-outcome",
  "x-paperclip-request-cache",
  "x-paperclip-tab-visible",
  "x-paperclip-publication-id",
  "x-paperclip-cloud-stack-id",
  "x-paperclip-cloud-paperclip-company-id",
  "x-paperclip-cloud-user-id",
  "x-paperclip-cloud-async-import",
  "x-paperclip-cloud-forwarded-host",
  "x-paperclip-cloud-forwarded-proto",
  "x-paperclip-advanced",
  "x-paperclip-group",
]);

const KNOWN_SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "x-xsrf-token",
  "x-api-key",
  "x-telegram-bot-api-secret-token",
  "x-paperclip-tool-gateway-token",
  "x-paperclip-github-capability",
  "x-paperclip-dev-server-status-token",
  "x-paperclip-cloud-runtime-identity",
  "x-paperclip-cloud-control",
  "x-paperclip-signature",
]);

const CREDENTIAL_HEADER_PATTERN =
  /(^|[-_])(authorization|cookie|secret|session[-_]?token|auth[-_]?token|token|capability|signature|credential)([-_]|$)|(^|[-_])api[-_]?key([-_]|$)/i;

/** Returns true if the header name represents an authentication or credential value. */
export function isCredentialBearingHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (SAFE_DIAGNOSTIC_HEADER_NAMES.has(normalized)) return false;
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
    if (isCredentialBearingHeader(key)) {
      out[key] = "[Redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

const BEARER_AUTH_PATTERN =
  /\bBearer\s+(?!(?:<token>|<[^>]+>|token|tokens|credentials?|auth|header)(?:[\s"',;`.]|$))[^\s"',;`]+/gi;
const GATEWAY_TOKEN_PATTERN = /\bpcg[wt]_[A-Za-z0-9_.-]+\b/g;
const URL_CREDENTIAL_QUERY_PATTERN =
  /([?&](?:token|sessionToken|gatewayToken|gateway_token|toolGatewayToken|tool_gateway_token|x-paperclip-tool-gateway-token|access_token|refresh_token|secret|api_key)=)[^&#\s]+/gi;

/** Strips Bearer secrets, Paperclip gateway tokens, and query credentials from arbitrary prose or error messages. */
export function sanitizeCredentialText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return text
    .replace(BEARER_AUTH_PATTERN, "Bearer [REDACTED]")
    .replace(GATEWAY_TOKEN_PATTERN, "[REDACTED]")
    .replace(URL_CREDENTIAL_QUERY_PATTERN, "$1[REDACTED]");
}

/** Sanitizes error messages, stacks, and attached custom properties from credential leakage. */
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
    if (key === "message" || key === "stack" || key === "type" || key === "name") {
      continue;
    }
    if (isCredentialBearingHeader(key)) {
      out[key] = "[REDACTED]";
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

export { collectRequestCredentials } from "./redact-sensitive.js";


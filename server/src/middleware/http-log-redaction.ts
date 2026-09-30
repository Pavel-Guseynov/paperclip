import { IncomingMessage, ServerResponse } from "node:http";

/**
 * The two redaction markers, each defined exactly once here and imported by
 * every redactor. `HEADER_REDACTION_MARKER` is pino's own `redact` censor and
 * marks a header or field removed by name; `VALUE_REDACTION_MARKER` is what
 * the recursive value redactor writes in place of a credential value.
 */
export const HEADER_REDACTION_MARKER = "[Redacted]";
export const VALUE_REDACTION_MARKER = "[REDACTED]";

/** Stand-ins for values a bounded walk refuses to serialize. */
export const CIRCULAR_MARKER = "[Circular]";
export const HTTP_OBJECT_MARKER = "[HttpObject]";
export const UNREADABLE_MARKER = "[Unreadable]";

/**
 * The depth bound every redactor shares. Deeper objects are omitted or replaced
 * with a marker because their contents cannot be safely inspected within it.
 */
export const REDACTION_MAX_DEPTH = 6;

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

/**
 * A Node HTTP object never reaches a log sink as itself: it is cyclic, it owns
 * the raw socket, and its `headers` carry live credentials. Every redactor
 * replaces it with this content-free projection.
 */
export function summarizeHttpObject(value: unknown): Record<string, unknown> {
  const v = (value ?? {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = { type: HTTP_OBJECT_MARKER };
  if (typeof v.method === "string") summary.method = v.method;
  if (typeof v.statusCode === "number") summary.statusCode = v.statusCode;
  return summary;
}

/**
 * The same credential reaches a log as a header (`proxy-authorization`), a
 * snake_case body field (`proxy_authorization`) or a camelCase log field
 * (`proxyAuthorization`). Comparing separator-free lower case makes one list
 * cover every spelling instead of enumerating them.
 */
function normalizeCredentialName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]/g, "");
}

const KNOWN_CREDENTIAL_NAMES: ReadonlySet<string> = new Set<string>(
  [...CREDENTIAL_HEADER_NAMES, ...CREDENTIAL_LOG_FIELD_NAMES].map(
    normalizeCredentialName,
  ),
);

/**
 * The credential header and field names, in any separator spelling. This is
 * the single authority every name-based redactor falls through to, so no
 * consumer keeps its own partial copy of the list.
 */
export function isKnownCredentialName(name: string): boolean {
  return KNOWN_CREDENTIAL_NAMES.has(normalizeCredentialName(name));
}

const CREDENTIAL_HEADER_PATTERN =
  /(^|[-_])(authorization|cookie|secret|session[-_]?token|auth[-_]?token|token|capability|signature|credential)([-_]|$)|(^|[-_])api[-_]?key([-_]|$)/i;

/**
 * Returns true if the header name represents an authentication or credential
 * value. The pattern arm deliberately over-matches, which is safe for a header
 * name and unsafe for an arbitrary record key: key-based redactors use
 * `isKnownCredentialName` instead.
 */
export function isCredentialBearingHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (isKnownCredentialName(normalized)) return true;
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
 * The words Paperclip's own diagnostics put after an auth scheme name. Every
 * credential this code handles is opaque: minted gateway tokens
 * (`pcgt_<uuid>.<secret>`), OAuth/JWT bearers, Basic base64 and provider API
 * keys. None of them is a single English word, so the prose exemption is this
 * closed list plus placeholder shapes, never a length or character-class
 * heuristic that a real lowercase token could satisfy.
 */
const NON_CREDENTIAL_AUTH_VALUES: ReadonlySet<string> = new Set([
  "absent",
  "auth",
  "authentication",
  "authorization",
  "credential",
  "credentials",
  "expired",
  "header",
  "headers",
  "invalid",
  "missing",
  "present",
  "required",
  "scheme",
  "secret",
  "token",
  "tokens",
  "value",
]);

/** Returns true when an auth-scheme value is credential material, not prose. */
function isCredentialLikeAuthValue(value: string): boolean {
  if (/^<[^>]*>$/.test(value) || /^\[[^\]]*\]$/.test(value)) return false;
  return !NON_CREDENTIAL_AUTH_VALUES.has(value.toLowerCase());
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
 *
 * Provider SDK errors attach arbitrary objects, including back-references to
 * the live request/response, so the walk is bounded by `REDACTION_MAX_DEPTH`
 * and a visited set: pino calls serializers without a try/catch, and a
 * RangeError here would escape every `logger.error` on the failure path.
 */
export function sanitizeErrorObject(err: unknown): unknown {
  return sanitizeErrorValue(err, 0, new WeakSet());
}

function sanitizeErrorValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return sanitizeCredentialText(value);
  if (!value || typeof value !== "object") return value;
  if (isHttpObject(value)) return summarizeHttpObject(value);
  if (seen.has(value)) return CIRCULAR_MARKER;
  if (depth > REDACTION_MAX_DEPTH) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeErrorValue(entry, depth + 1, seen));
    }
    return sanitizeErrorRecord(value, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function sanitizeErrorRecord(
  err: object,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
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
    if (typeof error.type === "string") {
      out.type = error.type;
    } else if (typeof error.name === "string") {
      out.type = error.name;
    }
    if (typeof error.message === "string") {
      out.message = sanitizeCredentialText(error.message);
    }
    if (typeof error.stack === "string") {
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
    out[key] = isCredentialBearingHeader(key)
      ? VALUE_REDACTION_MARKER
      : sanitizeErrorValue(value, depth + 1, seen);
  }
  return out;
}

/**
 * The top-level keys pino routes through `serializers.req` / `res` / `err`,
 * which turn a live HTTP object into a safe projection themselves. Under any
 * other key there is no serializer and no redact path, so the object must be
 * projected before it reaches the stringifier.
 */
const SERIALIZER_OWNED_KEYS: ReadonlySet<string> = new Set(["req", "res", "err"]);

/**
 * Censors credential-named fields inside a log record and replaces subtrees at
 * the inspection limit. The input is returned unchanged when no field needs
 * redaction, so an ordinary shallow record is scanned but never cloned. A key
 * matches only a name from `isKnownCredentialName` — a credential header or field
 * name in any separator spelling, never the over-matching header pattern — so
 * diagnostic fields keep their values. `Error` instances are left to the `err`
 * serializer. This never throws: a record a logger cannot read must not take
 * down the log call that reports the failure.
 */
export function redactCredentialFields(value: unknown): unknown {
  try {
    return redactFieldsValue(value, 0, new WeakSet());
  } catch {
    // Every read of the outermost value is guarded, so this is a last resort
    // for a failure outside those reads (for example a revoked proxy, which
    // pino's own stringifier cannot write either).
    return value;
  }
}

/** Reads one own property, yielding a marker when its getter throws. */
function readFieldValue(source: object, key: string | number): unknown {
  try {
    return (source as Record<string | number, unknown>)[key];
  } catch {
    return UNREADABLE_MARKER;
  }
}

/**
 * Recurses into one entry. A throwing getter or proxy trap costs that entry
 * only: the rest of the record still gets redacted, so a credential in a
 * sibling subtree never reaches the stream because a neighbour misbehaved.
 */
function redactFieldsEntry(
  entry: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  try {
    return redactFieldsValue(entry, depth, seen);
  } catch {
    return UNREADABLE_MARKER;
  }
}

/**
 * Runs a type probe that reads the value. A proxy trap that throws during the
 * probe means "not this type": the caller then enumerates the keys, reading
 * each field under its own guard, instead of abandoning the whole pass.
 */
function probeType(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function redactFieldsValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (probeType(() => value instanceof Error)) return value;
  if (probeType(() => isHttpObject(value))) {
    try {
      return summarizeHttpObject(value);
    } catch {
      return UNREADABLE_MARKER;
    }
  }
  if (seen.has(value)) return CIRCULAR_MARKER;
  // Never send an uninspected subtree to the sink: it may contain credentials.
  if (depth >= REDACTION_MAX_DEPTH) return HEADER_REDACTION_MARKER;

  let keys: readonly (string | number)[];
  try {
    // Enumerate without reading: neither an index range nor `Object.keys`
    // runs a getter, so one hostile field cannot abort the whole pass.
    keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_unused, index) => index)
      : Object.keys(value);
  } catch {
    // A record whose keys cannot be listed is not written by pino either, so
    // the outermost value is returned as it is. A nested one is marked.
    return depth === 0 ? value : UNREADABLE_MARKER;
  }

  seen.add(value);
  try {
    let changed = false;
    const out: Record<string | number, unknown> = Array.isArray(value)
      ? ([] as unknown as Record<string | number, unknown>)
      : {};
    for (const key of keys) {
      if (typeof key === "string" && isKnownCredentialName(key)) {
        const entry = readFieldValue(value, key);
        out[key] = entry === VALUE_REDACTION_MARKER
          ? VALUE_REDACTION_MARKER
          : HEADER_REDACTION_MARKER;
        if (out[key] !== entry) changed = true;
        continue;
      }
      const entry = readFieldValue(value, key);
      if (entry === UNREADABLE_MARKER) {
        out[key] = UNREADABLE_MARKER;
        changed = true;
        continue;
      }
      if (
        depth === 0 &&
        typeof key === "string" &&
        SERIALIZER_OWNED_KEYS.has(key) &&
        probeType(() => isHttpObject(entry))
      ) {
        out[key] = entry;
        continue;
      }
      const next = redactFieldsEntry(entry, depth + 1, seen);
      if (next !== entry) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  } finally {
    seen.delete(value);
  }
}

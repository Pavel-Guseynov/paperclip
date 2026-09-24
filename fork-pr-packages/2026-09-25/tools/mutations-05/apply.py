import sys, pathlib
root = pathlib.Path("/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/fix05")
HLR = root / "server/src/middleware/http-log-redaction.ts"
LOG = root / "server/src/middleware/logger.ts"
RS  = root / "server/src/middleware/redact-sensitive.ts"
EH  = root / "server/src/middleware/error-handler.ts"

def sub(path, old, new):
    s = path.read_text()
    assert old in s, f"anchor missing in {path.name}"
    path.write_text(s.replace(old, new, 1))

m = sys.argv[1]

if m == "M1":  # upstream literal redact-path list
    sub(HLR, '''export const HTTP_LOG_REDACT_PATHS: readonly string[] = [
  // Request and response header objects produced by pino's HTTP serializers.
  ...CREDENTIAL_HEADER_NAMES.flatMap((name) => [
    redactPath("req.headers", name),
    redactPath("res.headers", name),
  ]),
  // The same names bound directly onto a record or a child logger.
  ...CREDENTIAL_HEADER_NAMES.map((name) => redactPath("", name)),
  ...CREDENTIAL_LOG_FIELD_NAMES.map((name) => redactPath("", name)),''',
'''export const HTTP_LOG_REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  'req.headers["proxy-authorization"]',
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-api-key"]',
  'req.headers["x-paperclip-github-capability"]',
  'req.headers["x-telegram-bot-api-secret-token"]',''')
elif m == "M2":  # header redactor becomes identity
    sub(HLR, '''  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isCredentialBearingHeader(key) ? HEADER_REDACTION_MARKER : value;
  }
  return out;''', '''  return headers;''')
elif m == "M3":  # drop the std serializer composition
    sub(LOG, 'return sanitizeErrorObject(pino.stdSerializers.err(err as Error));',
             'return sanitizeErrorObject(err);')
elif m == "M4":  # drop the message hook
    s = LOG.read_text()
    start = s.index("  hooks: {")
    end = s.index("} satisfies LoggerOptions;")
    LOG.write_text(s[:start] + s[end:])
elif m == "M5":  # error context keeps the raw payload
    sub(EH, '''    error: {
      ...payload,
      message: sanitizeCredentialText(payload.message),
      ...(typeof payload.stack === "string"
        ? { stack: sanitizeCredentialText(payload.stack) }
        : {}),
    },''', '''    error: payload,''')
elif m == "M6":  # pre-review credential text patterns
    sub(HLR, '''const AUTH_SCHEME_PATTERN =
  /\\b(Bearer|Basic|Digest)(\\s+)(<[^>\\s]*>|\\[[^\\]\\s]*\\]|[A-Za-z0-9_~+/=-]+(?:\\.[A-Za-z0-9_~+/=-]+)*)/gi;''',
'''const AUTH_SCHEME_PATTERN =
  /\\b(Bearer)(\\s+)((?!(?:<token>|<[^>]+>|token|tokens|credentials?|auth|header)(?:[\\s"',;`.]|$))[^\\s"',;`]+)/gi;''')
    sub(HLR, 'const GATEWAY_TOKEN_PATTERN = /\\bpcg[wt]_[A-Za-z0-9-]+\\.[A-Za-z0-9_-]{8,}/g;',
             'const GATEWAY_TOKEN_PATTERN = /\\bpcg[wt]_[A-Za-z0-9_.-]+\\b/g;')
    sub(HLR, '''  if (/^<[^>]*>$/.test(value) || /^\\[[^\\]]*\\]$/.test(value)) return false;
  if (/^[a-z]+$/.test(value) && value.length < 20) return false;
  return true;''', '''  return true;''')
elif m == "M7":  # key names routed back through the header pattern
    sub(RS, '''function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}''', '''function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || isCredentialBearingHeader(normalized);
}''')
    sub(RS, '''import {
  isHttpObject,''', '''import {
  isCredentialBearingHeader,
  isHttpObject,''')
elif m == "M8":  # no credential-text sanitizing inside redactSensitive
    sub(RS, '''      if (isUrlishKey(key)) {
        out[key] = stripSecretBearingUrlParts(entry);
      } else {
        out[key] = sanitizeCredentialText(entry);
      }
      continue;''', '''      if (isUrlishKey(key)) {
        out[key] = stripSecretBearingUrlParts(entry);
        continue;
      }
      out[key] = entry;
      continue;''')
elif m == "M9":  # response headers not redacted by the serializer
    sub(LOG, '''        if (res.headers && typeof res.headers === "object") {
          return {
            ...res,
            headers: redactSensitiveHeaders(
              res.headers as Record<string, unknown>,
            ),
          };
        }
        return res;''', '''        return res;''')
elif m == "M10":  # the previous branch's deep-cloning logMethod hook
    sub(LOG, '''    logMethod(this: unknown, inputArgs: unknown[], method: any) {
      for (let index = 0; index < inputArgs.length; index += 1) {
        const arg = inputArgs[index];
        if (typeof arg === "string") {
          const safe = sanitizeCredentialText(arg);
          if (safe !== arg) inputArgs[index] = safe;
        }
      }
      return method.apply(this, inputArgs);
    },''', '''    logMethod(this: unknown, inputArgs: unknown[], method: any) {
      const sanitized = inputArgs.map((arg) => {
        if (arg instanceof Error) return sanitizeErrorObject(arg);
        if (typeof arg === "string") return sanitizeCredentialText(arg);
        if (!arg || typeof arg !== "object") return arg;
        return redactSensitive(arg);
      });
      return method.apply(this, sanitized);
    },''')
elif m == "M11":  # response prose keeps provider-echoed credentials
    sub(EH, """  const sanitized =
    typeof value === "string" ? sanitizeCredentialText(value) : value;
  if (!isSecretSensitiveHttpRequest(req.method, req.originalUrl)) {
    return sanitized;
  }""", """  const sanitized = value;
  if (!isSecretSensitiveHttpRequest(req.method, req.originalUrl)) {
    return sanitized;
  }""")
else:
    raise SystemExit(f"unknown mutation {m}")
print(f"applied {m}")

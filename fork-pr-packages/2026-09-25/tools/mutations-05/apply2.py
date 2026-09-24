import sys, pathlib
root = pathlib.Path("/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/fix05")
HLR = root / "server/src/middleware/http-log-redaction.ts"
LOG = root / "server/src/middleware/logger.ts"
RS  = root / "server/src/middleware/redact-sensitive.ts"

def sub(path, old, new):
    s = path.read_text()
    assert old in s, f"anchor missing in {path.name}"
    path.write_text(s.replace(old, new, 1))

m = sys.argv[1]

if m == "N1":  # unbounded, cycle-unsafe error walk
    sub(HLR, '''  if (seen.has(value)) return CIRCULAR_MARKER;
  if (depth > REDACTION_MAX_DEPTH) return undefined;
  seen.add(value);''', '''  seen.add(value);''')
elif m == "N2":  # arrays collapse into objects
    sub(HLR, '''    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeErrorValue(entry, depth + 1, seen));
    }
    return sanitizeErrorRecord(value, depth, seen);''',
        '''    return sanitizeErrorRecord(value, depth, seen);''')
elif m == "N3":  # response-body scrubbing outside upstream's gate
    EH = root / "server/src/middleware/error-handler.ts"
    sub(EH, '''  if (!isSecretSensitiveHttpRequest(req.method, req.originalUrl)) return value;''',
        '''  if (!isSecretSensitiveHttpRequest(req.method, req.originalUrl)) {
    return typeof value === "string"
      ? (0, eval)("require")("./http-log-redaction.js")
      : value;
  }''')
elif m == "N4":  # live HTTP objects pass through unredacted
    sub(HLR, '''export function summarizeHttpObject(value: unknown): Record<string, unknown> {
  const v = (value ?? {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = { type: HTTP_OBJECT_MARKER };
  if (typeof v.method === "string") summary.method = v.method;
  if (typeof v.statusCode === "number") summary.statusCode = v.statusCode;
  return summary;
}''', '''export function summarizeHttpObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}''')
elif m == "N5":  # redact-sensitive keeps its own partial list
    sub(RS, '''  const normalized = key.toLowerCase();
  // `isKnownCredentialName` owns the credential header and field names, so
  // this module never keeps a second, drifting copy of that list.
  return SENSITIVE_KEYS.has(normalized) || isKnownCredentialName(normalized);''',
        '''  return SENSITIVE_KEYS.has(key.toLowerCase());''')
elif m == "N6":  # length/character-class prose heuristic
    sub(HLR, '''  if (/^<[^>]*>$/.test(value) || /^\\[[^\\]]*\\]$/.test(value)) return false;
  return !NON_CREDENTIAL_AUTH_VALUES.has(value.toLowerCase());''',
        '''  if (/^<[^>]*>$/.test(value) || /^\\[[^\\]]*\\]$/.test(value)) return false;
  if (/^[a-z]+$/.test(value) && value.length < 20) return false;
  return true;''')
elif m == "N7":  # no nested field redaction in the hook
    sub(LOG, '''        const safe =
          typeof arg === "string"
            ? sanitizeCredentialText(arg)
            : redactCredentialFields(arg);''',
        '''        const safe =
          typeof arg === "string" ? sanitizeCredentialText(arg) : arg;''')
else:
    raise SystemExit(f"unknown mutation {m}")
print(f"applied {m}")

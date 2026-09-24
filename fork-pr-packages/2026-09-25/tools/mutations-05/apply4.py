import sys, pathlib
root = pathlib.Path("/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/fix05")
HLR = root / "server/src/middleware/http-log-redaction.ts"
LOG = root / "server/src/middleware/logger.ts"

def sub(path, old, new):
    s = path.read_text()
    assert old in s, f"anchor missing in {path.name}"
    path.write_text(s.replace(old, new, 1))

m = sys.argv[1]
if m == "C1":
    # Previous shape: eager read of every key, whole-pass catch in the hook.
    sub(HLR, '''    keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_unused, index) => index)
      : Object.keys(value);''',
        '''    keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_unused, index) => index)
      : Object.keys(value);
    for (const key of keys) void (value as Record<string | number, unknown>)[key];''')
    sub(LOG, '''      for (let index = 0; index < inputArgs.length; index += 1) {
        const arg = inputArgs[index];
        const safe =
          typeof arg === "string"
            ? sanitizeCredentialText(arg)
            : redactCredentialFields(arg);
        if (safe !== arg) inputArgs[index] = safe;
      }''', '''      try {
        for (let index = 0; index < inputArgs.length; index += 1) {
          const arg = inputArgs[index];
          const safe =
            typeof arg === "string"
              ? sanitizeCredentialText(arg)
              : redactCredentialFields(arg);
          if (safe !== arg) inputArgs[index] = safe;
        }
      } catch {
        // previous whole-pass fallback
      }''')
elif m == "C2":
    # No per-entry recursion guard.
    sub(HLR, '''  try {
    return redactFieldsValue(entry, depth, seen);
  } catch {
    return UNREADABLE_MARKER;
  }''', '''  return redactFieldsValue(entry, depth, seen);''')
elif m == "C3":
    # No outer guard on redactCredentialFields.
    sub(HLR, '''  try {
    return redactFieldsValue(value, 0, new WeakSet());
  } catch {
    // Only a hostile proxy trap on the outermost value reaches here; pino's
    // own stringifier reports the same failure for the record itself.
    return value;
  }''', '''  return redactFieldsValue(value, 0, new WeakSet());''')
else:
    raise SystemExit(m)
print(f"applied {m}")

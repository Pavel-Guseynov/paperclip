import sys, pathlib
root = pathlib.Path("/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/fix05")
HLR = root / "server/src/middleware/http-log-redaction.ts"
LOG = root / "server/src/middleware/logger.ts"

def sub(path, old, new):
    s = path.read_text()
    assert old in s, f"anchor missing in {path.name}"
    path.write_text(s.replace(old, new, 1))

m = sys.argv[1]
if m == "NEW1":
    sub(HLR, '      if (depth === 0 && SERIALIZER_OWNED_KEYS.has(key) && isHttpObject(entry)) {',
             '      if (depth === 0 && isHttpObject(entry)) {')
elif m == "NEW2":
    sub(HLR, '''function normalizeCredentialName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]/g, "");
}''', '''function normalizeCredentialName(name: string): string {
  return name.trim().toLowerCase();
}''')
elif m == "NEW3":
    sub(LOG, '''      try {
        for (let index = 0; index < inputArgs.length; index += 1) {
          const arg = inputArgs[index];
          const safe =
            typeof arg === "string"
              ? sanitizeCredentialText(arg)
              : redactCredentialFields(arg);
          if (safe !== arg) inputArgs[index] = safe;
        }
      } catch {''', '''      {
        for (let index = 0; index < inputArgs.length; index += 1) {
          const arg = inputArgs[index];
          const safe =
            typeof arg === "string"
              ? sanitizeCredentialText(arg)
              : redactCredentialFields(arg);
          if (safe !== arg) inputArgs[index] = safe;
        }
      }
      if (false) {''')
else:
    raise SystemExit(m)
print(f"applied {m}")

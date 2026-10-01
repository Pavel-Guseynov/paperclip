#!/bin/bash
# Generate scripts/.run-vitest-all.mjs in the current repo: upstream's run-vitest-stable.mjs
# with the early exit on a failing vitest invocation replaced by a recorded failure.
set -e
src=scripts/run-vitest-stable.mjs; dst=scripts/.run-vitest-all.mjs
python3 - "$src" "$dst" <<'PY'
import sys
s=open(sys.argv[1]).read()
old='''  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}'''
assert s.count(old)==1
s=s.replace(old,'''  if (result.status !== 0) {
    failedInvocations.push(`${label} (exit ${result.status})`);
  }
}''')
s=s.replace("let invocationIndex = 0;","let invocationIndex = 0;\nconst failedInvocations = [];",1)
s+='''
console.log(`\\n[test:all] ${invocationIndex} invocations, ${failedInvocations.length} failed`);
for (const failed of failedInvocations) console.log(`[test:all] FAILED: ${failed}`);
process.exit(failedInvocations.length > 0 ? 1 : 0);
'''
open(sys.argv[2],'w').write(s)
PY
grep -qxF 'scripts/.run-vitest-all.mjs' .git/info/exclude 2>/dev/null || { gd=$(git rev-parse --git-dir); grep -qxF 'scripts/.run-vitest-all.mjs' "$gd/info/exclude" 2>/dev/null || echo 'scripts/.run-vitest-all.mjs' >> "$gd/info/exclude"; }

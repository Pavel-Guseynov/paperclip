// Prints the serialized server suites that scripts/run-vitest-stable.mjs selects,
// one repo-relative path per line, using the runner's own --dry-run output.
import { execFileSync } from "node:child_process";

const output = execFileSync("node", ["scripts/run-vitest-stable.mjs", "--mode", "serialized", "--dry-run"], {
  encoding: "utf8",
});
for (const suite of JSON.parse(output).selectedSerializedSuites) console.log(suite);

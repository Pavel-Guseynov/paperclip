import { fileURLToPath } from "node:url";
import { runWithTestEvidence } from "../../../scripts/vitest-output-evidence.mjs";

const result = await runWithTestEvidence({ command: process.execPath,
  args: [fileURLToPath(new URL("./test-output-child.mjs", import.meta.url)), "graceful"],
  cwd: process.cwd(), env: { ...process.env }, directory: process.argv[2], label: "graceful stop" });
process.exitCode = result.status;

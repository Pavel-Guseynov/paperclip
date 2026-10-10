import { execFileSync } from "node:child_process";
import { startEventLoopStallReporter } from "../../event-loop-stall-reporter.js";

// Runs in its own process: the parent test reads the reporter's stderr records.
const mode = process.argv[2];
const reporter = startEventLoopStallReporter({ thresholdMs: 300, beatMs: 50, pollMs: 50, resampleMs: 600 });

function holdTheEventLoopForTest(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy */ }
}

setTimeout(() => {
  if (mode === "javascript") holdTheEventLoopForTest(1500);
  else if (mode === "subprocess") execFileSync("sleep", ["2"]);
  else if (mode === "native-wait") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}, 200);

setTimeout(async () => {
  await reporter?.stop();
  process.exit(0);
}, 3500);

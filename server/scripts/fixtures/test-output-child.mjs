const mode = process.argv[2];
if (mode === "large") {
  for (let index = 0; index < 1100; index++) process.stdout.write(`${index}:${"x".repeat(1000)}\n`);
  const unicode = Buffer.from("last:🧪\n");
  process.stdout.write(unicode.subarray(0, 7));
  process.stdout.write(unicode.subarray(7));
  process.stderr.write('original failure: {"token":"fixture-only-private-value"}\n');
  process.stderr.write("final unterminated diagnostic");
} else if (mode === "failed") {
  process.stdout.write("fixture launch completed\n");
  throw new Error("known outer failure", { cause: new Error("known original cause; TOKEN=fixture-only-private-value") });
} else if (mode === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xc3, 0x28]));
} else if (mode === "graceful") {
  process.stdin.resume();
  process.once("SIGTERM", () => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.child_stopped" })}\n`);
    process.stdin.pause();
  });
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.ready" })}\n`);
} else if (mode === "remove-evidence") {
  process.stdout.write("original successful child\n");
  rmSync(process.argv[3], { recursive: true });
} else {
  throw new Error(`Unknown output fixture ${mode}`);
}
import { rmSync } from "node:fs";

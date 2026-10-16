import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const [apiUrl, issueId] = process.argv.slice(2);
try {
  const token = process.env.PAPERCLIP_API_KEY;
  if (!token) throw new Error("The native process adapter did not supply its run credential");
  const headers = {
    authorization: `Bearer ${token}`,
    "x-paperclip-run-id": process.env.PAPERCLIP_RUN_ID,
    "content-type": "application/json",
  };
  const response = await fetch(`${apiUrl}/api/issues/${issueId}/comments`, {
    method: "POST", headers,
    body: JSON.stringify({ body: "Original author resumed to correct F4 in the retained workspace." }),
    signal: AbortSignal.timeout(5_000),
  });
  const comment = await response.json();
  if (response.status !== 201) throw new Error(`Native author comment returned ${response.status}: ${JSON.stringify(comment)}`);
  const { stdout } = await promisify(execFile)("git", ["symbolic-ref", "--short", "HEAD"]);
  const retained = await readFile("finding-F4.txt", "utf8");
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "review_recovery.author_resumed", params: {
    runId: process.env.PAPERCLIP_RUN_ID, commentId: comment.id, branch: stdout.trim(), retained,
  } })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "review_recovery.author_failed", params: {
    error: { type: error.name, message: error.message, traceback: error.stack },
  } })}\n`);
  process.exitCode = 1;
}

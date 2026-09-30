import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function getSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") {
        files.push(...(await getSourceFiles(fullPath)));
      }
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      if (!entry.name.includes(".test.")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

describe("Single status-transition authority static check", () => {
  it("verifies that 0 .update(heartbeatRuns) sites in server/src write status outside transitionHeartbeatRunStatus", async () => {
    const serverSrcDir = path.resolve(__dirname, "..");
    const files = await getSourceFiles(serverSrcDir);

    const violations: { file: string; line: number; excerpt: string }[] = [];

    for (const file of files) {
      const relativePath = path.relative(serverSrcDir, file);
      // heartbeat-run-lifecycle.ts is the single authority allowed to update status on heartbeatRuns
      if (relativePath === "services/heartbeat-run-lifecycle.ts") {
        continue;
      }

      const content = await readFile(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(".update(heartbeatRuns)")) {
          const rest = lines.slice(i).join("\n");
          const setIdx = rest.indexOf(".set(");
          if (setIdx !== -1) {
            let depth = 0;
            let inString: string | null = null;
            let topLevelContent = "";
            for (let j = setIdx + 5; j < rest.length; j++) {
              const char = rest[j];
              if (inString) {
                if (char === inString && rest[j - 1] !== "\\") {
                  inString = null;
                }
              } else if (char === "'" || char === '"' || char === "`") {
                inString = char;
              } else if (char === "{") {
                depth++;
              } else if (char === "}") {
                depth--;
                if (depth === 0) break;
              } else if (depth === 1) {
                topLevelContent += char;
              }
            }
            if (/\bstatus\s*:/.test(topLevelContent)) {
              violations.push({
                file: relativePath,
                line: i + 1,
                excerpt: line.trim(),
              });
            }
          }
        }
      }
    }

    expect(
      violations,
      `Found ${violations.length} .update(heartbeatRuns) sites that write status outside transitionHeartbeatRunStatus:\n` +
        violations.map((v) => `  ${v.file}:${v.line} -> ${v.excerpt}`).join("\n"),
    ).toEqual([]);
  });
});

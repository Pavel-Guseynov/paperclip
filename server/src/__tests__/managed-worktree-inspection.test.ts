import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectManagedGitWorktreeBranch } from "../services/workspace-runtime.js";

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(longPaths = false, run = exec) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "worktree-inspection-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  const parent = longPaths ? path.join(root, "a".repeat(200), "b".repeat(200), "c".repeat(200), "d".repeat(200)) : root;
  const worktree = path.join(parent, "zz-task");
  await fs.mkdir(parent, { recursive: true });
  await run("git", ["init", repo]);
  await run("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  await run("git", ["-C", repo, "worktree", "add", "-b", "work", worktree]);
  await fs.writeFile(path.join(worktree, "retained.txt"), "retained work\n");
  return { root, repo, worktree, parent };
}

describe("managed worktree registration inspection with real Git", () => {
  it("accepts complete registration and rejects an independent checkout", async () => {
    const { repo, worktree, root } = await fixture();
    expect(await inspectManagedGitWorktreeBranch({ repoRoot: repo, worktreePath: worktree, expectedBranchName: "work" })).toMatchObject({ valid: true, reasonCode: null });
    const other = path.join(root, "other");
    await exec("git", ["clone", repo, other]);
    expect(await inspectManagedGitWorktreeBranch({ repoRoot: repo, worktreePath: other, expectedBranchName: null })).toMatchObject({ valid: false, reasonCode: "not_registered" });
  });

  it("distinguishes a failed real Git inspection from absent registration and preserves work", async () => {
    const { root, worktree } = await fixture();
    const invalidRepo = path.join(root, "not-a-repository");
    await fs.mkdir(invalidRepo);
    expect(await inspectManagedGitWorktreeBranch({ repoRoot: invalidRepo, worktreePath: worktree, expectedBranchName: "work" })).toMatchObject({
      valid: false, reasonCode: "git_inspection_failed",
      inspectionDiagnostic: { command: "worktree_list", failure: "nonzero_exit", exitCode: 128 },
    });
    expect(await fs.readFile(path.join(worktree, "retained.txt"), "utf8")).toBe("retained work\n");
  });

  it("reports a genuinely unavailable Git executable without inventing a registration mismatch", async () => {
    const { root, repo, worktree } = await fixture();
    vi.stubEnv("PATH", root);
    expect(await inspectManagedGitWorktreeBranch({ repoRoot: repo, worktreePath: worktree, expectedBranchName: "work" })).toMatchObject({
      valid: false, reasonCode: "git_inspection_failed",
      inspectionDiagnostic: { command: "worktree_list", failure: "spawn_failed", errorCode: "ENOENT" },
    });
  });

  it("rejects incomplete real registration output even when its captured tail includes the selected worktree", async ({ onTestFailed }) => {
    const started = performance.now();
    let phaseStarted = started;
    let phase = "fixture_setup";
    let completedAdds = 0;
    let byteLength = 0;
    let command: string[] = [];
    let cwd = process.cwd();
    let exitStatus: number | string | null = null;
    let failed = false;
    const evidence = (outcome: string) => ({
      phase, outcome, elapsedMs: performance.now() - phaseStarted,
      totalElapsedMs: performance.now() - started, completedAdds, byteLength,
      command, cwd, exitStatus,
    });
    const report = (outcome: string, error?: unknown) => {
      const record = { ...evidence(outcome), error: error instanceof Error ? error.message : error ?? null };
      process.stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "test.phase", params: record })}\n`);
      return JSON.stringify(record);
    };
    onTestFailed(({ task }) => {
      failed = true;
      const errors = task.result?.errors ?? [];
      const context = report("failed", errors.map(error => error.message));
      for (const error of errors) error.message = `${error.message}\n${context}`;
    });
    const run: typeof exec = async (...args) => {
      if (failed) throw new Error("Test already failed; no further Git child will be started");
      command = [args[0], ...(args[1] as string[])];
      const repoIndex = command.indexOf("-C");
      cwd = repoIndex >= 0 ? command[repoIndex + 1] : process.cwd();
      exitStatus = null;
      try {
        const result = await exec(...args);
        exitStatus = 0;
        return result;
      } catch (error) {
        exitStatus = (error as NodeJS.ErrnoException).code ?? "unavailable";
        throw new Error(report("child_failed", error), { cause: error });
      }
    };
    const nextPhase = (next: string) => {
      const context = report("completed");
      expect(performance.now() - started, context).toBeLessThan(60_000);
      phase = next;
      phaseStarted = performance.now();
      exitStatus = null;
    };
    report("started");
    const { repo, worktree, parent } = await fixture(true, run);
    for (let index = 0; index < 340; index++) {
      await run("git", ["-C", repo, "worktree", "add", "--detach", "--no-checkout", path.join(parent, `listed-${index}`)]);
      completedAdds++;
    }
    nextPhase("worktree_list");
    const complete = (await run("git", ["-C", repo, "worktree", "list", "--porcelain"], { maxBuffer: 1024 * 1024 })).stdout;
    byteLength = Buffer.byteLength(complete);
    expect(byteLength).toBeGreaterThan(300_000);
    expect(complete).toContain(`worktree ${worktree}\n`);
    expect(complete.slice(-300_000)).toContain(`worktree ${worktree}\n`);
    nextPhase("inspection");
    const inspection = await inspectManagedGitWorktreeBranch({ repoRoot: repo, worktreePath: worktree, expectedBranchName: "work" });
    exitStatus = inspection.inspectionDiagnostic?.exitCode ?? 0;
    expect(inspection, JSON.stringify(evidence("assertion"))).toMatchObject({
      valid: false, reasonCode: "git_inspection_failed",
      inspectionDiagnostic: { command: "worktree_list", failure: "output_truncated" },
    });
    expect(await fs.readFile(path.join(worktree, "retained.txt"), "utf8")).toBe("retained work\n");
    nextPhase("finished");
  }, 60_000);
});

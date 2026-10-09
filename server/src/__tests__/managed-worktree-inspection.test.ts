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

async function fixture(longPaths = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "worktree-inspection-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  const parent = longPaths ? path.join(root, "a".repeat(200), "b".repeat(200), "c".repeat(200)) : root;
  const worktree = path.join(parent, "zz-task");
  await fs.mkdir(parent, { recursive: true });
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
  await exec("git", ["-C", repo, "worktree", "add", "-b", "work", worktree]);
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

  it("rejects incomplete real registration output even when its captured tail includes the selected worktree", async () => {
    const { repo, worktree, parent } = await fixture(true);
    for (let index = 0; index < 500; index++) {
      await exec("git", ["-C", repo, "worktree", "add", "--detach", "--no-checkout", path.join(parent, `listed-${index}`)]);
    }
    const complete = (await exec("git", ["-C", repo, "worktree", "list", "--porcelain"], { maxBuffer: 1024 * 1024 })).stdout;
    expect(Buffer.byteLength(complete)).toBeGreaterThan(300_000);
    expect(complete).toContain(`worktree ${worktree}\n`);
    expect(await inspectManagedGitWorktreeBranch({ repoRoot: repo, worktreePath: worktree, expectedBranchName: "work" })).toMatchObject({
      valid: false, reasonCode: "git_inspection_failed",
      inspectionDiagnostic: { command: "worktree_list", failure: "output_truncated" },
    });
    expect(await fs.readFile(path.join(worktree, "retained.txt"), "utf8")).toBe("retained work\n");
  }, 60_000);
});

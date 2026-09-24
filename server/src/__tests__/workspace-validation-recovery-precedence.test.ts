import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  ensurePersistedExecutionWorkspaceAvailable,
  WorkspaceRuntimeValidationFailure,
} from "../services/workspace-runtime.js";
import {
  findWorkspaceValidationFailure,
  WorkspaceValidationFailure,
} from "../services/heartbeat.js";
import { issueRecoveryActionService } from "../services/issue-recovery-actions.js";
import { recoveryService } from "../services/recovery/service.js";

const execFileAsync = promisify(execFile);
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

async function runGit(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function readGit(cwd: string, args: string[]) {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

async function createTempRepo(defaultBranch = "main") {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "paperclip-wv-repo-"),
  );
  await runGit(repoRoot, ["init"]);
  await runGit(repoRoot, ["config", "user.email", "paperclip@example.com"]);
  await runGit(repoRoot, ["config", "user.name", "Paperclip Test"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "# Initial\n", "utf8");
  await runGit(repoRoot, ["add", "README.md"]);
  await runGit(repoRoot, ["commit", "-m", "Initial commit"]);
  await runGit(repoRoot, ["checkout", "-B", defaultBranch]);
  return repoRoot;
}

/**
 * `isRuntimeOwnedGitBranch` reads `createdByRuntime` together with the current
 * ownership metadata version. `createdByRuntime: false` is an operator-owned
 * branch: the runtime may never move its ref or check out another branch.
 */
function ownershipMetadata(createdByRuntime: boolean) {
  return {
    createdByRuntime,
    gitBranchOwnershipVersion: 1,
  };
}

function restoreInput(options: {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  createdByRuntime: boolean;
  issueIdentifier: string;
}) {
  return {
    base: {
      baseCwd: options.repoRoot,
      source: "project_primary" as const,
      projectId: "proj-1",
      workspaceId: "ws-1",
      repoUrl: null,
      repoRef: "main",
    },
    workspace: {
      id: `exec-ws-${options.issueIdentifier}`,
      mode: "isolated_workspace" as const,
      strategyType: "git_worktree",
      cwd: options.worktreePath,
      providerRef: options.worktreePath,
      projectId: "proj-1",
      projectWorkspaceId: "ws-1",
      repoUrl: null,
      baseRef: "main",
      branchName: options.branchName,
      metadata: ownershipMetadata(options.createdByRuntime),
    },
    issue: {
      id: `issue-${options.issueIdentifier}`,
      identifier: options.issueIdentifier,
      title: `Workspace validation test ${options.issueIdentifier}`,
    },
    agent: {
      id: "agent-1",
      name: "Test Agent",
      companyId: "comp-1",
    },
  };
}

async function captureWorkspaceValidation(
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  let caught: unknown = null;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(WorkspaceRuntimeValidationFailure);
  const payload = (caught as WorkspaceRuntimeValidationFailure).resultJson
    .workspaceValidation;
  expect(payload).toBeTypeOf("object");
  return payload as Record<string, unknown>;
}

describe("workspace validation recovery precedence", () => {
  describe("git worktree branch coherence and detached HEAD", () => {
    it("reuses a runtime-owned worktree that is coherent on the expected branch", async () => {
      const repoRoot = await createTempRepo("main");
      const worktreePath = await fs.mkdtemp(
        path.join(os.tmpdir(), "paperclip-wt-coherent-"),
      );
      await runGit(repoRoot, [
        "worktree",
        "add",
        "-b",
        "PAP-101-test",
        worktreePath,
        "main",
      ]);

      const realized = await ensurePersistedExecutionWorkspaceAvailable(
        restoreInput({
          repoRoot,
          worktreePath,
          branchName: "PAP-101-test",
          createdByRuntime: true,
          issueIdentifier: "PAP-101",
        }),
      );

      expect(realized?.cwd).toBe(worktreePath);
      expect(realized?.branchName).toBe("PAP-101-test");
    });

    it("diagnoses a runtime-owned detached HEAD as branch incoherence and reissues from its exact commit", async () => {
      const repoRoot = await createTempRepo("main");
      const worktreePath = await fs.mkdtemp(
        path.join(os.tmpdir(), "paperclip-wt-detached-"),
      );
      await runGit(repoRoot, [
        "worktree",
        "add",
        "-b",
        "PAP-103-detached",
        worktreePath,
        "main",
      ]);

      await runGit(worktreePath, ["checkout", "--detach"]);
      const uniqueFile = path.join(worktreePath, "unique-work.txt");
      await fs.writeFile(uniqueFile, "precious work on detached head\n", "utf8");
      await runGit(worktreePath, ["add", "unique-work.txt"]);
      await runGit(worktreePath, [
        "commit",
        "-m",
        "Commit with unique work on detached HEAD",
      ]);

      // Advance the recorded branch so it diverges from the detached HEAD.
      await runGit(repoRoot, ["checkout", "PAP-103-detached"]);
      await fs.writeFile(path.join(repoRoot, "other.txt"), "branch work\n", "utf8");
      await runGit(repoRoot, ["add", "other.txt"]);
      await runGit(repoRoot, ["commit", "-m", "Diverging branch commit"]);

      const detachedCommitSha = await readGit(worktreePath, ["rev-parse", "HEAD"]);
      expect(detachedCommitSha).toMatch(/^[0-9a-f]{40}$/);

      const validation = await captureWorkspaceValidation(() =>
        ensurePersistedExecutionWorkspaceAvailable(
          restoreInput({
            repoRoot,
            worktreePath,
            branchName: "PAP-103-detached",
            createdByRuntime: true,
            issueIdentifier: "PAP-103",
          }),
        ),
      );

      expect(validation.reason).toBe("git_worktree_branch_incoherence");
      expect(validation.expectedBranch).toBe("PAP-103-detached");
      expect(validation.actualBranch).toBeNull();
      const provenance = validation.provenance as Record<string, unknown>;
      expect(provenance.actualHeadSha).toBe(detachedCommitSha);
      expect(provenance.expectedBranchRef).toBe("refs/heads/PAP-103-detached");
      expect(provenance.ancestryVerdict).toBe("diverged");
      expect((validation.safeRepair as { eligible: boolean }).eligible).toBe(false);

      // The original workspace is retained, unique commits included.
      expect(await readGit(worktreePath, ["rev-parse", "HEAD"])).toBe(
        detachedCommitSha,
      );
      expect(await fs.readFile(uniqueFile, "utf8")).toBe(
        "precious work on detached head\n",
      );

      // The recorded diagnosis is enough to reissue from the exact commit.
      const reissueBaseRef =
        (validation.actualBranch as string | null) ??
        (provenance.actualHeadSha as string);
      await runGit(worktreePath, [
        "checkout",
        "-b",
        "PAP-103-recovered",
        reissueBaseRef,
      ]);
      expect(await readGit(worktreePath, ["rev-parse", "HEAD"])).toBe(
        detachedCommitSha,
      );
      expect(await readGit(worktreePath, ["log", "-1", "--pretty=%B"])).toContain(
        "Commit with unique work on detached HEAD",
      );
    });

    it.each([
      { label: "detached commit", detach: true, dirty: false },
      { label: "dirty forward branch", detach: false, dirty: true },
    ])(
      "records the live HEAD commit when an operator-owned worktree moved to a $label",
      async ({ detach, dirty }) => {
        const repoRoot = await createTempRepo("main");
        const branchName = detach
          ? "feature/operator-detached"
          : "feature/operator-forward";
        const worktreePath = await fs.mkdtemp(
          path.join(os.tmpdir(), "paperclip-wt-operator-"),
        );
        await runGit(repoRoot, [
          "worktree",
          "add",
          "-b",
          branchName,
          worktreePath,
          "main",
        ]);
        const recordedBranchTip = await readGit(repoRoot, [
          "rev-parse",
          `refs/heads/${branchName}`,
        ]);

        if (detach) {
          await runGit(worktreePath, ["checkout", "--detach"]);
        } else {
          await runGit(worktreePath, ["checkout", "-b", `${branchName}-other`]);
        }
        await fs.writeFile(
          path.join(worktreePath, "operator-work.txt"),
          "operator work\n",
          "utf8",
        );
        await runGit(worktreePath, ["add", "operator-work.txt"]);
        await runGit(worktreePath, ["commit", "-m", "Operator work"]);
        if (dirty) {
          await fs.writeFile(
            path.join(worktreePath, "dirty.txt"),
            "uncommitted changes\n",
            "utf8",
          );
        }
        const liveHeadSha = await readGit(worktreePath, ["rev-parse", "HEAD"]);

        const validation = await captureWorkspaceValidation(() =>
          ensurePersistedExecutionWorkspaceAvailable(
            restoreInput({
              repoRoot,
              worktreePath,
              branchName,
              createdByRuntime: false,
              issueIdentifier: detach ? "PAP-104" : "PAP-105",
            }),
          ),
        );

        // The operator-owned contract is unchanged: the mismatch is rejected as
        // "not reusable", never re-diagnosed as a repairable incoherence.
        expect(validation.reason).toBe("git_worktree_not_reusable");
        expect(validation.reasonCode).toBe("branch_mismatch");
        expect(validation.safeRepair).toBeUndefined();
        // The live commit is recorded, so the operator can reissue from it.
        expect(validation.expectedBranch).toBe(branchName);
        expect(validation.actualBranch).toBe(
          detach ? null : `${branchName}-other`,
        );
        expect(validation.actualHeadSha).toBe(liveHeadSha);

        // No git state was mutated by the rejection.
        expect(await readGit(repoRoot, ["rev-parse", `refs/heads/${branchName}`])).toBe(
          recordedBranchTip,
        );
        expect(await readGit(worktreePath, ["rev-parse", "HEAD"])).toBe(liveHeadSha);
        expect(await readGit(worktreePath, ["branch", "--show-current"])).toBe(
          detach ? "" : `${branchName}-other`,
        );
      },
    );
  });

  describe("wrapped workspace validation failures", () => {
    function buildInnerFailure() {
      return new WorkspaceValidationFailure("Workspace validation failed", {
        workspaceValidation: {
          reason: "git_worktree_branch_incoherence",
          sourceIssueId: "issue-1",
          executionWorkspaceId: "ws-1",
          expectedBranch: "main",
          actualBranch: null,
          provenance: {
            expectedHeadSha: "def5678",
            actualHeadSha: "abc1234",
            ancestryVerdict: "diverged",
          },
          safeRepair: { eligible: false },
        },
      });
    }

    it("finds the typed failure through a generic wrapper's cause chain", () => {
      const innerFailure = buildInnerFailure();
      const wrappedError = new Error("setup_failed: failed to initialize adapter", {
        cause: new Error("restore failed", { cause: innerFailure }),
      });

      const extracted = findWorkspaceValidationFailure(wrappedError);
      expect(extracted).toBe(innerFailure);
      expect(
        (extracted?.resultJson.workspaceValidation as Record<string, unknown>)
          .reason,
      ).toBe("git_worktree_branch_incoherence");
    });

    it("returns null for a generic error without a workspace validation cause", () => {
      expect(
        findWorkspaceValidationFailure(
          new Error("process_lost: child process terminated"),
        ),
      ).toBeNull();
    });

    it("terminates on a self-referencing cause chain", () => {
      const looping = new Error("outer") as Error & { cause?: unknown };
      looping.cause = looping;
      expect(findWorkspaceValidationFailure(looping)).toBeNull();
    });
  });

  describeEmbeddedPostgres(
    "recovery precedence, review startup, and deduplication in database",
    () => {
      let db: ReturnType<typeof createDb>;
      let cleanupDb: () => Promise<void>;
      const companyId = randomUUID();
      const agentId = randomUUID();
      const reviewerAgentId = randomUUID();
      const projectId = randomUUID();

      beforeAll(async () => {
        const { connectionString, cleanup } =
          await startEmbeddedPostgresTestDatabase(
            "workspace-validation-precedence",
          );
        cleanupDb = cleanup;
        db = createDb(connectionString);

        await db.insert(companies).values({
          id: companyId,
          name: "Test Co",
          description: "Workspace Validation Precedence Test Co",
          status: "active",
        });

        await db.insert(agents).values([
          {
            id: agentId,
            companyId,
            name: "Coder Agent",
            role: "software_engineer",
            adapterType: "process",
            adapterConfig: {},
            status: "idle",
          },
          {
            id: reviewerAgentId,
            companyId,
            name: "Reviewer Agent",
            role: "reviewer",
            adapterType: "process",
            adapterConfig: {},
            status: "idle",
          },
        ]);

        await db.insert(projects).values({
          id: projectId,
          companyId,
          name: "Test Project",
          status: "active",
        });
      });

      afterAll(async () => {
        await cleanupDb?.();
      });

      it("escalates a failed review participant to workspace_validation_failed and preserves its typed evidence", async () => {
        const issueId = randomUUID();
        const stageId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-201",
          title: "In-review workspace validation recovery",
          status: "in_review",
          priority: "medium",
          assigneeAgentId: agentId,
          executionPolicy: {
            mode: "normal",
            commentRequired: true,
            stages: [
              {
                id: stageId,
                type: "review",
                approvalsNeeded: 1,
                participants: [
                  {
                    id: randomUUID(),
                    type: "agent",
                    agentId: reviewerAgentId,
                    userId: null,
                  },
                ],
              },
            ],
          },
          executionState: {
            status: "pending",
            currentStageId: stageId,
            currentStageIndex: 0,
            currentStageType: "review",
            currentParticipant: {
              type: "agent",
              agentId: reviewerAgentId,
              userId: null,
            },
            returnAssignee: { type: "agent", agentId, userId: null },
            reviewRequest: null,
            completedStageIds: [],
            lastDecisionId: null,
            lastDecisionOutcome: null,
          },
        });

        const actualHeadSha = "1234567890abcdef1234567890abcdef12345678";
        await db.insert(heartbeatRuns).values({
          id: randomUUID(),
          companyId,
          agentId: reviewerAgentId,
          status: "failed",
          errorCode: "workspace_validation_failed",
          error:
            "Execution workspace expected git worktree branch but HEAD is detached",
          contextSnapshot: {
            issueId,
            executionReviewParticipant: true,
          },
          resultJson: {
            // Startup persists the typed diagnosis together with the bootstrap
            // marker, exactly as the setup failure path writes it.
            executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
            workspaceValidation: {
              reason: "git_worktree_branch_incoherence",
              sourceIssueId: issueId,
              executionWorkspaceId: "exec-ws-review",
              expectedBranch: "PAP-201-review",
              actualBranch: null,
              provenance: {
                expectedHeadSha:
                  "0000000000000000000000000000000000000000",
                actualHeadSha,
                ancestryVerdict: "diverged",
              },
              safeRepair: { eligible: false },
            },
          },
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        const reconcileResult = await recoveryService(db, {
          enqueueWakeup: vi.fn(),
        }).reconcileStrandedAssignedIssues();
        expect(reconcileResult.issueIds).toContain(issueId);

        const activeAction = await issueRecoveryActionService(
          db,
        ).getActiveForIssue(companyId, issueId);

        expect(activeAction?.cause).toBe("workspace_validation_failed");
        expect(activeAction?.kind).toBe("workspace_validation");
        expect(activeAction?.nextAction).toContain(
          "git worktree branch incoherence",
        );
        const workspaceValidation = (
          activeAction?.evidence as {
            workspaceValidation?: Record<string, unknown>;
          }
        ).workspaceValidation;
        expect(workspaceValidation?.reason).toBe(
          "git_worktree_branch_incoherence",
        );
        expect(
          (workspaceValidation?.provenance as Record<string, unknown>)
            .actualHeadSha,
        ).toBe(actualHeadSha);
      });

      it("leaves an active workspace_validation action untouched when a generic sweep writes", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-202",
          title: "Precedence test issue",
          status: "in_progress",
          priority: "medium",
          assigneeAgentId: agentId,
        });

        const actualHeadSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        const recoveryActionSvc = issueRecoveryActionService(db);

        const initial = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `workspace_validation:${issueId}`,
          ownerType: "board",
          evidence: {
            workspaceValidation: {
              reason: "git_worktree_branch_incoherence",
              actualHeadSha,
            },
          },
          nextAction: "Inspect detached workspace before reissuing run.",
        });

        const genericAttempt = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "stranded_assigned_issue",
          cause: "stranded_assigned_issue",
          fingerprint: `stranded:${issueId}`,
          ownerType: "board",
          supersedeOnIdentityChange: true,
          evidence: { latestRunStatus: "failed" },
          nextAction: "Generic stranded recovery.",
        });

        expect(genericAttempt.id).toBe(initial.id);
        expect(genericAttempt.cause).toBe("workspace_validation_failed");
        expect(genericAttempt.kind).toBe("workspace_validation");
        expect(genericAttempt.nextAction).toBe(initial.nextAction);
        expect(genericAttempt.attemptCount).toBe(initial.attemptCount);
        const evidence = genericAttempt.evidence as {
          workspaceValidation?: { actualHeadSha: string };
          latestRunStatus?: string;
        };
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(actualHeadSha);
        expect(evidence.latestRunStatus).toBeUndefined();
      });

      it("still supersedes an active workspace_validation action for a later failure that names its own cause", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-204",
          title: "Distinct later failure",
          status: "in_progress",
          priority: "medium",
          assigneeAgentId: agentId,
        });

        const recoveryActionSvc = issueRecoveryActionService(db);
        const initial = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `workspace_validation:${issueId}`,
          ownerType: "board",
          evidence: {
            workspaceValidation: { reason: "git_worktree_branch_incoherence" },
          },
          nextAction: "Inspect the workspace before reissuing the run.",
        });

        const laterFailure = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "configuration_validation",
          cause: "configuration_incomplete",
          fingerprint: `configuration_incomplete:${issueId}`,
          ownerType: "board",
          supersedeOnIdentityChange: true,
          evidence: { configurationIncomplete: { reason: "missing_secret" } },
          nextAction: "Bind the missing secret, then retry.",
        });

        expect(laterFailure.id).not.toBe(initial.id);
        expect(laterFailure.cause).toBe("configuration_incomplete");
        expect(laterFailure.kind).toBe("configuration_validation");
        const active = await recoveryActionSvc.getActiveForIssue(
          companyId,
          issueId,
        );
        expect(active?.id).toBe(laterFailure.id);
      });

      it("keeps the typed workspace validation payload when a later write replaces the evidence", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-203",
          title: "Deduplication test issue",
          status: "in_progress",
          priority: "medium",
          assigneeAgentId: agentId,
        });

        const actualHeadSha = "9999999999999999999999999999999999999999";
        const recoveryActionSvc = issueRecoveryActionService(db);

        const first = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-fp:${issueId}`,
          ownerType: "board",
          evidence: {
            workspaceValidation: {
              reason: "git_worktree_branch_incoherence",
              actualHeadSha,
              provenance: { ancestryVerdict: "diverged" },
            },
            routingPolicy: "board_escalation",
          },
          nextAction: "Action 1",
        });

        expect(first.attemptCount).toBe(1);

        const second = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-fp:${issueId}`,
          ownerType: "board",
          evidence: {
            workspaceValidation: { cleanliness: "dirty" },
            additionalNote: "repeated run failed identically",
          },
          nextAction: "Action 2",
        });

        expect(second.id).toBe(first.id);
        expect(second.attemptCount).toBe(2);
        const evidence = second.evidence as {
          workspaceValidation?: Record<string, unknown>;
          additionalNote?: string;
          routingPolicy?: string;
        };
        // The typed diagnosis survives and deep-merges...
        expect(evidence.workspaceValidation?.reason).toBe(
          "git_worktree_branch_incoherence",
        );
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(actualHeadSha);
        expect(evidence.workspaceValidation?.cleanliness).toBe("dirty");
        expect(evidence.additionalNote).toBe("repeated run failed identically");
        // ...while every other key keeps the established replace semantics.
        expect(evidence.routingPolicy).toBeUndefined();
      });
    },
  );
});

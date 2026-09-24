import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
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
 * ownership metadata version. Only a runtime-owned branch may be checked out,
 * adopted or re-pointed by the coherence repair.
 */
function restoreRuntimeOwnedInput(options: {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
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
      metadata: { createdByRuntime: true, gitBranchOwnershipVersion: 1 },
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
        restoreRuntimeOwnedInput({
          repoRoot,
          worktreePath,
          branchName: "PAP-101-test",
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

      let caught: unknown = null;
      try {
        await ensurePersistedExecutionWorkspaceAvailable(
          restoreRuntimeOwnedInput({
            repoRoot,
            worktreePath,
            branchName: "PAP-103-detached",
            issueIdentifier: "PAP-103",
          }),
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WorkspaceRuntimeValidationFailure);
      const validation = (caught as WorkspaceRuntimeValidationFailure).resultJson
        .workspaceValidation as Record<string, unknown>;

      expect(validation.reason).toBe("git_worktree_branch_incoherence");
      expect(validation.expectedBranch).toBe("PAP-103-detached");
      expect(validation.actualBranch).toBeNull();
      expect(validation.cleanliness).toBe("clean");
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

    it("keeps a dirty runtime-owned mismatch unrepairable and preserves the uncommitted work", async () => {
      const repoRoot = await createTempRepo("main");
      const worktreePath = await fs.mkdtemp(
        path.join(os.tmpdir(), "paperclip-wt-dirty-"),
      );
      await runGit(repoRoot, [
        "worktree",
        "add",
        "-b",
        "PAP-102-dirty",
        worktreePath,
        "main",
      ]);
      await runGit(worktreePath, ["checkout", "-b", "PAP-102-dirty-other"]);
      await fs.writeFile(
        path.join(worktreePath, "dirty.txt"),
        "uncommitted changes\n",
        "utf8",
      );

      let caught: unknown = null;
      try {
        await ensurePersistedExecutionWorkspaceAvailable(
          restoreRuntimeOwnedInput({
            repoRoot,
            worktreePath,
            branchName: "PAP-102-dirty",
            issueIdentifier: "PAP-102",
          }),
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WorkspaceRuntimeValidationFailure);
      const validation = (caught as WorkspaceRuntimeValidationFailure).resultJson
        .workspaceValidation as Record<string, unknown>;

      expect(validation.reason).toBe("git_worktree_branch_incoherence");
      expect(validation.cleanliness).toBe("dirty");
      expect(validation.dirtyPathSample).toContain("dirty.txt");
      expect((validation.safeRepair as { eligible: boolean }).eligible).toBe(false);
      expect(await fs.readFile(path.join(worktreePath, "dirty.txt"), "utf8")).toBe(
        "uncommitted changes\n",
      );
    });
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
      const terminatedAgentId = randomUUID();
      const projectId = randomUUID();

      const ACTUAL_HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";

      /** The payload a startup workspace-validation failure persists. */
      function workspaceValidationRunResultJson(actualHeadSha = ACTUAL_HEAD_SHA) {
        return {
          // Startup persists the typed diagnosis together with the bootstrap
          // marker, exactly as the setup failure path writes it.
          executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
          workspaceValidation: {
            reason: "git_worktree_branch_incoherence",
            executionWorkspaceId: "exec-ws-1",
            expectedBranch: "PAP-work",
            actualBranch: null,
            provenance: {
              expectedHeadSha: "0000000000000000000000000000000000000000",
              actualHeadSha,
              ancestryVerdict: "diverged",
            },
            safeRepair: { eligible: false },
          },
        };
      }

      async function insertRun(input: {
        agentId: string;
        issueId: string;
        errorCode: string;
        error: string;
        resultJson: Record<string, unknown>;
        extraContext?: Record<string, unknown>;
        finishedAt?: Date;
      }) {
        const runId = randomUUID();
        await db.insert(heartbeatRuns).values({
          id: runId,
          companyId,
          agentId: input.agentId,
          status: "failed",
          errorCode: input.errorCode,
          error: input.error,
          contextSnapshot: { issueId: input.issueId, ...input.extraContext },
          resultJson: input.resultJson,
          startedAt: input.finishedAt ?? new Date(),
          finishedAt: input.finishedAt ?? new Date(),
        });
        return runId;
      }

      function reviewIssueValues(input: {
        issueId: string;
        identifier: string;
        title: string;
        participantAgentId: string;
      }) {
        const stageId = randomUUID();
        return {
          id: input.issueId,
          companyId,
          projectId,
          identifier: input.identifier,
          title: input.title,
          status: "in_review" as const,
          priority: "medium" as const,
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
                    agentId: input.participantAgentId,
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
              agentId: input.participantAgentId,
              userId: null,
            },
            returnAssignee: { type: "agent", agentId, userId: null },
            reviewRequest: null,
            completedStageIds: [],
            lastDecisionId: null,
            lastDecisionOutcome: null,
          },
        };
      }

      async function readSystemNoticeBodies(issueId: string) {
        const rows = await db
          .select({ body: issueComments.body })
          .from(issueComments)
          .where(
            and(
              eq(issueComments.issueId, issueId),
              eq(issueComments.authorType, "system"),
            ),
          );
        return rows.map((row) => row.body);
      }

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
          {
            id: terminatedAgentId,
            companyId,
            name: "Terminated Agent",
            role: "reviewer",
            adapterType: "process",
            adapterConfig: {},
            status: "terminated",
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
        await db.insert(issues).values(
          reviewIssueValues({
            issueId,
            identifier: "PAP-201",
            title: "In-review workspace validation recovery",
            participantAgentId: reviewerAgentId,
          }),
        );
        await insertRun({
          agentId: reviewerAgentId,
          issueId,
          errorCode: "workspace_validation_failed",
          error:
            "Execution workspace expected git worktree branch but HEAD is detached",
          resultJson: workspaceValidationRunResultJson(),
          extraContext: { executionReviewParticipant: true },
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
        ).toBe(ACTUAL_HEAD_SHA);

        // The operator notice names the typed diagnosis, and does not claim the
        // reviewer is unavailable when it is invokable.
        const notices = await readSystemNoticeBodies(issueId);
        const notice = notices.find((body) =>
          body.includes("execution workspace failed"),
        );
        expect(notice).toContain("git_worktree_branch_incoherence");
        expect(notice).not.toContain("not invokable");
      });

      it("reports both blockers when the failed review participant is also not invokable", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values(
          reviewIssueValues({
            issueId,
            identifier: "PAP-205",
            title: "Unavailable participant with a failed workspace",
            participantAgentId: terminatedAgentId,
          }),
        );
        await insertRun({
          agentId: terminatedAgentId,
          issueId,
          errorCode: "workspace_validation_failed",
          error:
            "Execution workspace expected git worktree branch but HEAD is detached",
          resultJson: workspaceValidationRunResultJson(),
          extraContext: { executionReviewParticipant: true },
        });

        const reconcileResult = await recoveryService(db, {
          enqueueWakeup: vi.fn(),
        }).reconcileStrandedAssignedIssues();
        expect(reconcileResult.issueIds).toContain(issueId);

        const activeAction = await issueRecoveryActionService(
          db,
        ).getActiveForIssue(companyId, issueId);
        expect(activeAction?.cause).toBe("workspace_validation_failed");

        const notices = await readSystemNoticeBodies(issueId);
        const notice = notices.find((body) =>
          body.includes("execution workspace failed"),
        );
        // Neither blocker is lost: the typed diagnosis and the unavailable
        // participant are both reported.
        expect(notice).toContain("git_worktree_branch_incoherence");
        expect(notice).toContain("not invokable");
      });

      it("holds the typed diagnosis when a later generic failure sweeps the same issue", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-206",
          title: "Headline precedence scenario",
          status: "in_progress",
          priority: "medium",
          // A terminated assignee makes the sweep take its escalation path
          // deterministically instead of requeueing the agent.
          assigneeAgentId: terminatedAgentId,
        });
        await insertRun({
          agentId: terminatedAgentId,
          issueId,
          errorCode: "workspace_validation_failed",
          error: "Execution workspace git worktree branch is incoherent",
          resultJson: workspaceValidationRunResultJson(),
          finishedAt: new Date(Date.now() - 60_000),
        });

        const recovery = recoveryService(db, { enqueueWakeup: vi.fn() });
        const firstSweep = await recovery.reconcileStrandedAssignedIssues();
        expect(firstSweep.issueIds).toContain(issueId);

        const recoveryActionSvc = issueRecoveryActionService(db);
        const afterFirstSweep = await recoveryActionSvc.getActiveForIssue(
          companyId,
          issueId,
        );
        expect(afterFirstSweep?.cause).toBe("workspace_validation_failed");
        expect(afterFirstSweep?.kind).toBe("workspace_validation");

        // The operator retried the task; the retry died of an unrelated,
        // generic adapter failure that carries no workspace diagnosis.
        await db
          .update(issues)
          .set({ status: "in_progress" })
          .where(eq(issues.id, issueId));
        await insertRun({
          agentId: terminatedAgentId,
          issueId,
          errorCode: "adapter_failed",
          error: "adapter failed",
          resultJson: {},
        });

        const secondSweep = await recovery.reconcileStrandedAssignedIssues();
        expect(secondSweep.issueIds).toContain(issueId);

        const afterSecondSweep = await recoveryActionSvc.getActiveForIssue(
          companyId,
          issueId,
        );
        expect(afterSecondSweep?.id).toBe(afterFirstSweep?.id);
        expect(afterSecondSweep?.cause).toBe("workspace_validation_failed");
        expect(afterSecondSweep?.kind).toBe("workspace_validation");
        expect(afterSecondSweep?.nextAction).toBe(afterFirstSweep?.nextAction);
        expect(
          (
            (
              afterSecondSweep?.evidence as {
                workspaceValidation?: Record<string, unknown>;
              }
            ).workspaceValidation?.provenance as Record<string, unknown>
          ).actualHeadSha,
        ).toBe(ACTUAL_HEAD_SHA);

        const actionRows = await db
          .select({ id: issueRecoveryActions.id })
          .from(issueRecoveryActions)
          .where(eq(issueRecoveryActions.sourceIssueId, issueId));
        expect(actionRows).toHaveLength(1);
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
              actualHeadSha: ACTUAL_HEAD_SHA,
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
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(ACTUAL_HEAD_SHA);
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

      it("merges a partial workspace diagnosis onto the recorded one on a preserving write", async () => {
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

        const recoveryActionSvc = issueRecoveryActionService(db);
        const first = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-fp:${issueId}`,
          ownerType: "board",
          preserveExistingOwner: true,
          evidence: {
            workspaceValidation: {
              reason: "git_worktree_branch_incoherence",
              actualHeadSha: ACTUAL_HEAD_SHA,
              provenance: { ancestryVerdict: "diverged" },
            },
            routingPolicy: "board_escalation",
          },
          nextAction: "Action 1",
        });

        expect(first.attemptCount).toBe(1);

        // The repeated sweep rebuilds the diagnosis from the newest run, which
        // only carries part of it.
        const second = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-fp:${issueId}`,
          ownerType: "board",
          preserveExistingOwner: true,
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
        // The partial rebuild merges onto the complete diagnosis instead of
        // replacing it.
        expect(evidence.workspaceValidation?.reason).toBe(
          "git_worktree_branch_incoherence",
        );
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(ACTUAL_HEAD_SHA);
        expect(evidence.workspaceValidation?.provenance).toEqual({
          ancestryVerdict: "diverged",
        });
        expect(evidence.workspaceValidation?.cleanliness).toBe("dirty");
        expect(evidence.additionalNote).toBe("repeated run failed identically");
        // Every other key keeps the established shallow-merge semantics.
        expect(evidence.routingPolicy).toBe("board_escalation");
      });

      it("replaces the evidence wholesale on a non-preserving write", async () => {
        const issueId = randomUUID();
        await db.insert(issues).values({
          id: issueId,
          companyId,
          projectId,
          identifier: "PAP-207",
          title: "Replacing evidence write",
          status: "in_progress",
          priority: "medium",
          assigneeAgentId: agentId,
        });

        const recoveryActionSvc = issueRecoveryActionService(db);
        await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-replace:${issueId}`,
          ownerType: "board",
          evidence: {
            workspaceValidation: { reason: "git_worktree_branch_incoherence" },
          },
          nextAction: "Action 1",
        });

        const replaced = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-replace:${issueId}`,
          ownerType: "board",
          evidence: { latestRunStatus: "failed" },
          nextAction: "Action 2",
        });

        expect(replaced.evidence).toEqual({ latestRunStatus: "failed" });
      });
    },
  );
});

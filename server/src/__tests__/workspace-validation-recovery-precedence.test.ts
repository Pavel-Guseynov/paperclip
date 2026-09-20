import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
  projectExecutionWorkspacePolicies,
  projects,
  projectWorkspaces,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  ensurePersistedExecutionWorkspaceAvailable,
  inspectGitWorktreeBranchIncoherence,
  WorkspaceRuntimeValidationFailure,
} from "../services/workspace-runtime.js";
import {
  getWorkspaceValidationFailure,
  isWorkspaceValidationFailure,
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

describe("workspace validation recovery precedence", () => {
  describe("git worktree branch coherence and detached HEAD", () => {
    it("succeeds when git worktree is coherent on the expected branch", async () => {
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

      const realized = await ensurePersistedExecutionWorkspaceAvailable({
        base: {
          baseCwd: repoRoot,
          source: "project_primary",
          projectId: "proj-1",
          workspaceId: "ws-1",
          repoUrl: null,
          repoRef: "main",
        },
        workspace: {
          id: "exec-ws-1",
          mode: "isolated_workspace",
          strategyType: "git_worktree",
          cwd: worktreePath,
          providerRef: worktreePath,
          projectId: "proj-1",
          projectWorkspaceId: "ws-1",
          repoUrl: null,
          baseRef: "main",
          branchName: "PAP-101-test",
          metadata: {
            v: 1,
            branchCreatedByRuntime: true,
            gitBranchOwnershipVersion: 1,
          },
        },
        issue: {
          id: "issue-1",
          identifier: "PAP-101",
          title: "Coherent worktree test",
        },
        agent: {
          id: "agent-1",
          name: "Test Agent",
          companyId: "comp-1",
        },
      });

      expect(realized.cwd).toBe(worktreePath);
      expect(realized.branchName).toBe("PAP-101-test");
    });

    it("rejects dirty worktree and captures uncommitted changes", async () => {
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

      // Switch to different branch so branch_mismatch triggers inspection
      await runGit(worktreePath, ["checkout", "-b", "other-branch"]);
      // Add dirty uncommitted changes
      await fs.writeFile(
        path.join(worktreePath, "dirty.txt"),
        "uncommitted changes\n",
        "utf8",
      );

      let caughtError: unknown = null;
      try {
        await ensurePersistedExecutionWorkspaceAvailable({
          base: {
            baseCwd: repoRoot,
            source: "project_primary",
            projectId: "proj-1",
            workspaceId: "ws-1",
            repoUrl: null,
            repoRef: "main",
          },
          workspace: {
            id: "exec-ws-dirty",
            mode: "isolated_workspace",
            strategyType: "git_worktree",
            cwd: worktreePath,
            providerRef: worktreePath,
            projectId: "proj-1",
            projectWorkspaceId: "ws-1",
            repoUrl: null,
            baseRef: "main",
            branchName: "PAP-102-dirty",
            metadata: {
              v: 1,
              branchCreatedByRuntime: true,
              gitBranchOwnershipVersion: 1,
            },
          },
          issue: {
            id: "issue-dirty",
            identifier: "PAP-102",
            title: "Dirty worktree test",
          },
          agent: {
            id: "agent-1",
            name: "Test Agent",
            companyId: "comp-1",
          },
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(WorkspaceRuntimeValidationFailure);
      const validation = (caughtError as WorkspaceRuntimeValidationFailure)
        .resultJson.workspaceValidation;
      expect(validation.reason).toBe("git_worktree_branch_incoherence");
      expect(validation.cleanliness).toBe("dirty");
      expect(validation.dirtyPathSample).toContain("dirty.txt");
      expect(validation.safeRepair.eligible).toBe(false);
    });

    it("diagnoses detached HEAD with unique commits and preserves actualHeadSha and reissueBaseRef without data loss", async () => {
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

      // Detach HEAD in the worktree
      await runGit(worktreePath, ["checkout", "--detach"]);

      // Create unique commits on the detached HEAD
      const uniqueFile = path.join(worktreePath, "unique-work.txt");
      await fs.writeFile(
        uniqueFile,
        "precious work on detached head\n",
        "utf8",
      );
      await runGit(worktreePath, ["add", "unique-work.txt"]);
      await runGit(worktreePath, [
        "commit",
        "-m",
        "Commit with unique work on detached HEAD",
      ]);

      // Advance the recorded branch in repoRoot so it diverges from detached HEAD
      await runGit(repoRoot, ["checkout", "PAP-103-detached"]);
      await fs.writeFile(
        path.join(repoRoot, "other.txt"),
        "branch work\n",
        "utf8",
      );
      await runGit(repoRoot, ["add", "other.txt"]);
      await runGit(repoRoot, ["commit", "-m", "Diverging branch commit"]);

      const detachedCommitSha = await readGit(worktreePath, [
        "rev-parse",
        "HEAD",
      ]);
      expect(detachedCommitSha).toMatch(/^[0-9a-f]{40}$/);

      let caughtError: unknown = null;
      try {
        await ensurePersistedExecutionWorkspaceAvailable({
          base: {
            baseCwd: repoRoot,
            source: "project_primary",
            projectId: "proj-1",
            workspaceId: "ws-1",
            repoUrl: null,
            repoRef: "main",
          },
          workspace: {
            id: "exec-ws-detached",
            mode: "isolated_workspace",
            strategyType: "git_worktree",
            cwd: worktreePath,
            providerRef: worktreePath,
            projectId: "proj-1",
            projectWorkspaceId: "ws-1",
            repoUrl: null,
            baseRef: "main",
            branchName: "PAP-103-detached",
            metadata: {
              v: 1,
              branchCreatedByRuntime: true,
              gitBranchOwnershipVersion: 1,
            },
          },
          issue: {
            id: "issue-detached",
            identifier: "PAP-103",
            title: "Detached HEAD test",
          },
          agent: {
            id: "agent-1",
            name: "Test Agent",
            companyId: "comp-1",
          },
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(WorkspaceRuntimeValidationFailure);
      const validation = (caughtError as WorkspaceRuntimeValidationFailure)
        .resultJson.workspaceValidation;
      expect(validation.reason).toBe("git_worktree_branch_incoherence");
      expect(validation.actualHeadSha).toBe(detachedCommitSha);
      expect(validation.reissueBaseRef).toBe(detachedCommitSha);
      expect(validation.provenance.actualHeadSha).toBe(detachedCommitSha);
      expect(validation.expectedBranch).toBe("PAP-103-detached");
      expect(validation.provenance.expectedBranchRef).toBe(
        "refs/heads/PAP-103-detached",
      );
      expect(validation.safeRepair.eligible).toBe(false);

      // Verify the worktree was NOT deleted
      const worktreeExists = await fs
        .stat(worktreePath)
        .then(() => true)
        .catch(() => false);
      expect(worktreeExists).toBe(true);
      const fileContent = await fs.readFile(uniqueFile, "utf8");
      expect(fileContent).toBe("precious work on detached head\n");

      // Verify reissue from exact actualHeadSha recovers the unique commits onto a new branch
      await runGit(worktreePath, [
        "checkout",
        "-b",
        "PAP-103-recovered",
        validation.reissueBaseRef!,
      ]);
      const recoveredHeadSha = await readGit(worktreePath, [
        "rev-parse",
        "HEAD",
      ]);
      expect(recoveredHeadSha).toBe(detachedCommitSha);
      const recoveredLog = await readGit(worktreePath, [
        "log",
        "-1",
        "--pretty=%B",
      ]);
      expect(recoveredLog).toContain(
        "Commit with unique work on detached HEAD",
      );
    });
  });

  describe("generic wrapper error unwrapping", () => {
    it("unwraps WorkspaceValidationFailure from a generic Error cause", () => {
      const innerFailure = new WorkspaceValidationFailure(
        "Workspace validation failed",
        {
          workspaceValidation: {
            reason: "git_worktree_branch_incoherence",
            sourceIssueId: "issue-1",
            executionWorkspaceId: "ws-1",
            expectedBranch: "main",
            actualBranch: null,
            actualHeadSha: "abc1234",
            reissueBaseRef: "abc1234",
            checkedOutHeadSha: "abc1234",
            provenance: {
              checkedOutHeadSha: "abc1234",
              expectedHeadSha: "def5678",
              actualHeadSha: "abc1234",
              expectedBranch: "main",
              actualBranch: null,
              ancestryVerdict: "diverged",
              verifiedAgainstOrigin: false,
            },
            incoherence: null,
            safeRepair: {
              eligible: false,
              attempted: false,
              succeeded: false,
              reason: "branch_mismatch",
            },
          },
        },
      );

      const wrappedError = new Error(
        "setup_failed: failed to initialize adapter",
        { cause: innerFailure },
      );

      expect(isWorkspaceValidationFailure(wrappedError)).toBe(true);
      const extracted = getWorkspaceValidationFailure(wrappedError);
      expect(extracted).not.toBeNull();
      expect(extracted?.resultJson.workspaceValidation?.reason).toBe(
        "git_worktree_branch_incoherence",
      );
      expect(extracted?.resultJson.workspaceValidation?.actualHeadSha).toBe(
        "abc1234",
      );
      expect(extracted?.resultJson.workspaceValidation?.reissueBaseRef).toBe(
        "abc1234",
      );
    });

    it("returns null for generic errors without a workspace validation cause", () => {
      const genericError = new Error("process_lost: child process terminated");
      expect(isWorkspaceValidationFailure(genericError)).toBe(false);
      expect(getWorkspaceValidationFailure(genericError)).toBeNull();
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

      it("review and approval participant recovery escalates to workspace_validation_failed and preserves typed evidence", async () => {
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

        const runId = randomUUID();
        const mockActualSha = "1234567890abcdef1234567890abcdef12345678";
        await db.insert(heartbeatRuns).values({
          id: runId,
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
            workspaceValidation: {
              reason: "git_worktree_branch_incoherence",
              sourceIssueId: issueId,
              executionWorkspaceId: "exec-ws-review",
              expectedBranch: "PAP-201-review",
              actualBranch: null,
              actualHeadSha: mockActualSha,
              reissueBaseRef: mockActualSha,
              checkedOutHeadSha: mockActualSha,
              provenance: {
                checkedOutHeadSha: mockActualSha,
                expectedHeadSha: "0000000000000000000000000000000000000000",
                actualHeadSha: mockActualSha,
                expectedBranch: "PAP-201-review",
                actualBranch: null,
                ancestryVerdict: "diverged",
                verifiedAgainstOrigin: false,
              },
              incoherence: null,
              safeRepair: {
                eligible: false,
                attempted: false,
                succeeded: false,
                reason: "branch_mismatch",
              },
            },
          },
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        const recoverySvc = recoveryService(db);
        const reconcileResult =
          await recoverySvc.reconcileStrandedAssignedIssues();
        expect(reconcileResult.issueIds).toContain(issueId);

        // Check recovery action created
        const recoveryActionSvc = issueRecoveryActionService(db);
        const activeAction = await recoveryActionSvc.getActiveForIssue(
          companyId,
          issueId,
        );

        expect(activeAction).not.toBeNull();
        expect(activeAction?.cause).toBe("workspace_validation_failed");
        expect(activeAction?.kind).toBe("workspace_validation");
        const actionEvidence = activeAction?.evidence as {
          workspaceValidation?: {
            actualHeadSha: string;
            reissueBaseRef: string;
            reason: string;
          };
        };
        expect(actionEvidence.workspaceValidation?.reason).toBe(
          "git_worktree_branch_incoherence",
        );
        expect(actionEvidence.workspaceValidation?.actualHeadSha).toBe(
          mockActualSha,
        );
        expect(actionEvidence.workspaceValidation?.reissueBaseRef).toBe(
          mockActualSha,
        );
      });

      it("precludes generic sweeps from overwriting an active workspace_validation action", async () => {
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

        const mockActualSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        const recoveryActionSvc = issueRecoveryActionService(db);

        // Create active workspace_validation action
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
              actualHeadSha: mockActualSha,
              reissueBaseRef: mockActualSha,
            },
          },
          nextAction: "Inspect detached workspace before reissuing run.",
        });

        expect(initial.cause).toBe("workspace_validation_failed");
        expect(initial.kind).toBe("workspace_validation");

        // Attempt to upsert a generic stranded_assigned_issue action
        const genericAttempt = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "stranded_assigned_issue",
          cause: "stranded_assigned_issue",
          fingerprint: `stranded:${issueId}`,
          ownerType: "board",
          evidence: {
            latestRunStatus: "failed",
          },
          nextAction: "Generic stranded recovery.",
        });

        // Must NOT overwrite or downgrade the workspace_validation action
        expect(genericAttempt.id).toBe(initial.id);
        expect(genericAttempt.cause).toBe("workspace_validation_failed");
        expect(genericAttempt.kind).toBe("workspace_validation");
        const evidence = genericAttempt.evidence as {
          workspaceValidation?: { actualHeadSha: string };
        };
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(mockActualSha);
      });

      it("deduplicates repeated validation without dropping evidence payload", async () => {
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

        const mockActualSha = "9999999999999999999999999999999999999999";
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
              actualHeadSha: mockActualSha,
              reissueBaseRef: mockActualSha,
              provenance: {
                ancestryVerdict: "diverged",
              },
            },
          },
          nextAction: "Action 1",
        });

        expect(first.attemptCount).toBe(1);

        // Repeated validation with the same fingerprint
        const second = await recoveryActionSvc.upsertSourceScoped({
          companyId,
          sourceIssueId: issueId,
          kind: "workspace_validation",
          cause: "workspace_validation_failed",
          fingerprint: `wv-fp:${issueId}`,
          ownerType: "board",
          evidence: {
            additionalNote: "repeated run failed identically",
          },
          nextAction: "Action 2",
        });

        expect(second.id).toBe(first.id);
        expect(second.attemptCount).toBe(2);
        // Payload must NOT be dropped
        const evidence = second.evidence as {
          workspaceValidation?: {
            actualHeadSha: string;
            reissueBaseRef: string;
            reason: string;
          };
          additionalNote?: string;
        };
        expect(evidence.workspaceValidation?.reason).toBe(
          "git_worktree_branch_incoherence",
        );
        expect(evidence.workspaceValidation?.actualHeadSha).toBe(mockActualSha);
        expect(evidence.workspaceValidation?.reissueBaseRef).toBe(mockActualSha);
        expect(evidence.additionalNote).toBe("repeated run failed identically");
      });
    },
  );
});

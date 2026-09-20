import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DeliveryVerificationService,
  createDeliveryVerificationService,
} from "../services/delivery-verification.ts";
import {
  verifyStageTerminalEvidence,
  applyIssueExecutionPolicyTransition,
  normalizeIssueExecutionPolicy,
} from "../services/issue-execution-policy.ts";
import type { IssueExecutionPolicy, IssueTerminalEvidence } from "@paperclipai/shared";

describe("DeliveryVerificationService", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("bypasses verification for operation tasks", async () => {
    const service = createDeliveryVerificationService();
    const result = await service.verifyTerminalDelivery({
      issue: { id: "issue-1", companyId: "comp-1", kind: "operation" },
    });
    expect(result.verified).toBe(true);
    expect(result.receipt).toBeNull();
  });

  it("bypasses verification for tasks labeled 'operation'", async () => {
    const service = createDeliveryVerificationService();
    const result = await service.verifyTerminalDelivery({
      issue: { id: "issue-2", companyId: "comp-1", labels: ["operation"] },
    });
    expect(result.verified).toBe(true);
    expect(result.receipt).toBeNull();
  });

  it("rejects when repo url is missing or unsupported", async () => {
    const service = createDeliveryVerificationService();
    const result = await service.verifyTerminalDelivery({
      issue: { id: "issue-3", companyId: "comp-1" },
      evidence: { pr: 12, mergedSha: "a1b2c3d4e5f67890123456789012345678901234" },
      repoUrl: "ftp://unknown.host/foo/bar",
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("delivery_unverified_unsupported_provider");
  });

  describe("GitHub Provider Verification", () => {
    const repoUrl = "https://github.com/paperclipai/paperclip";
    const reviewedHeadSha = "c6d3a6fa2ecb91d24c3e8006bf28741364d2629b";
    const mergedSha = "c6d3a6fa2ecb91d24c3e8006bf28741364d2629b";
    const baseRef = "master";

    it("verifies a successfully merged GitHub pull request with matching head and passing checks", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merged_at: "2026-09-20T18:00:00Z",
              merge_commit_sha: mergedSha,
              base: { ref: "master", sha: "base-sha-123" },
              head: { ref: "feat/some-feature", sha: reviewedHeadSha },
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/check-runs")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              total_count: 2,
              check_runs: [
                { name: "test", status: "completed", conclusion: "success" },
                { name: "lint", status: "completed", conclusion: "success" },
              ],
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/status")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              state: "success",
              statuses: [],
            }),
          } as Response;
        }
        if (urlStr.includes("/compare/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "ahead",
              ahead_by: 1,
              behind_by: 0,
            }),
          } as Response;
        }
        return { ok: false, status: 404, text: async () => "Not found" } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-4", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha, headSha: reviewedHeadSha },
        repoUrl,
        baseRef,
        reviewedHeadSha,
      });

      expect(result.verified).toBe(true);
      expect(result.receipt).toBeDefined();
      expect(result.receipt?.provider).toBe("github");
      expect(result.receipt?.repo).toBe("paperclipai/paperclip");
      expect(result.receipt?.pr).toBe(42);
      expect(result.receipt?.baseBranch).toBe("master");
      expect(result.receipt?.mergedSha).toBe(mergedSha);
      expect(result.receipt?.headSha).toBe(reviewedHeadSha);
      expect(result.receipt?.checksPassed).toBe(true);
      expect(result.receipt?.checksSummary).toEqual({
        total: 2,
        passed: 2,
        failed: 0,
        pending: 0,
      });
      // Ensure receipt contains no secrets
      expect(JSON.stringify(result.receipt)).not.toContain("token");
      expect(JSON.stringify(result.receipt)).not.toContain("Authorization");
    });

    it("rejects when PR is not merged", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "open",
              merged: false,
              base: { ref: "master" },
              head: { sha: reviewedHeadSha },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-5", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha },
        repoUrl,
        baseRef,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_not_merged");
      expect(result.reason).toContain("not merged");
    });

    it("rejects when PR target base branch does not match configured base", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merge_commit_sha: mergedSha,
              base: { ref: "staging" },
              head: { sha: reviewedHeadSha },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-6", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha },
        repoUrl,
        baseRef: "master",
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_base_mismatch");
      expect(result.reason).toContain("Base branch mismatch");
    });

    it("rejects when PR head SHA does not match the reviewed head SHA", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merge_commit_sha: "other-merge-sha-123",
              base: { ref: "master" },
              head: { sha: "unreviewed-head-sha" },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-7", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha },
        repoUrl,
        baseRef: "master",
        reviewedHeadSha: "expected-reviewed-head-sha",
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_head_mismatch");
      expect(result.reason).toContain("Head SHA mismatch");
    });

    it("rejects when checks are failing", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merge_commit_sha: mergedSha,
              base: { ref: "master" },
              head: { ref: "feat/x", sha: reviewedHeadSha },
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/check-runs")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              total_count: 2,
              check_runs: [
                { name: "test", status: "completed", conclusion: "failure" },
                { name: "lint", status: "completed", conclusion: "success" },
              ],
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/status")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              state: "failure",
              statuses: [],
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-8", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha, headSha: reviewedHeadSha },
        repoUrl,
        baseRef,
        reviewedHeadSha,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_checks_failing");
      expect(result.reason).toContain("Checks failing");
    });

    it("rejects when checks are pending or in progress", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merge_commit_sha: mergedSha,
              base: { ref: "master" },
              head: { ref: "feat/x", sha: reviewedHeadSha },
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/check-runs")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              total_count: 1,
              check_runs: [
                { name: "test", status: "in_progress", conclusion: null },
              ],
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/status")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              state: "pending",
              statuses: [],
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-9", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha, headSha: reviewedHeadSha },
        repoUrl,
        baseRef,
        reviewedHeadSha,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_checks_pending");
      expect(result.reason).toContain("Checks pending");
    });

    it("rejects when live base branch comparison reveals merged head is diverged / unreachable", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/42")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 42,
              state: "closed",
              merged: true,
              merge_commit_sha: mergedSha,
              base: { ref: "master" },
              head: { ref: "feat/x", sha: reviewedHeadSha },
            }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/check-runs")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ total_count: 0, check_runs: [] }),
          } as Response;
        }
        if (urlStr.includes("/commits/") && urlStr.includes("/status")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ state: "success", statuses: [] }),
          } as Response;
        }
        if (urlStr.includes("/compare/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "diverged",
              ahead_by: 3,
              behind_by: 2,
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-10", companyId: "comp-1" },
        evidence: { pr: 42, mergedSha, headSha: reviewedHeadSha },
        repoUrl,
        baseRef,
        reviewedHeadSha,
      });

      expect(result.verified).toBe(false);
      expect(result.errorCode).toBe("delivery_unverified_unreachable");
      expect(result.reason).toContain("Live base branch does not reach merged commit");
    });
  });

  describe("Gitea Provider Verification", () => {
    const repoUrl = "https://git.example.com/org/repo";
    const reviewedHeadSha = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3";
    const mergedSha = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3";
    const baseRef = "main";

    it("verifies a successfully merged Gitea pull request", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/pulls/101")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              number: 101,
              state: "closed",
              has_merged: true,
              merged: "2026-09-20T18:00:00Z",
              merged_commit_id: mergedSha,
              base: { ref: "main" },
              head: { sha: reviewedHeadSha },
            }),
          } as Response;
        }
        if (urlStr.includes("/statuses/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { context: "ci/build", status: "success" },
              { context: "ci/test", status: "success" },
            ],
          } as Response;
        }
        if (urlStr.includes("/branches/main")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: "main",
              commit: { id: mergedSha },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const service = createDeliveryVerificationService();
      const result = await service.verifyTerminalDelivery({
        issue: { id: "issue-11", companyId: "comp-1" },
        evidence: { pr: 101, mergedSha, headSha: reviewedHeadSha },
        repoUrl,
        baseRef,
        reviewedHeadSha,
      });

      expect(result.verified).toBe(true);
      expect(result.receipt).toBeDefined();
      expect(result.receipt?.provider).toBe("gitea");
      expect(result.receipt?.repo).toBe("org/repo");
      expect(result.receipt?.pr).toBe(101);
      expect(result.receipt?.baseBranch).toBe("main");
      expect(result.receipt?.mergedSha).toBe(mergedSha);
      expect(result.receipt?.checksPassed).toBe(true);
    });
  });

  describe("verifyStageTerminalEvidence integration", () => {
    it("throws 409 delivery_unverified_not_merged when verification fails", async () => {
      const mockVerifier = {
        verifyTerminalDelivery: vi.fn().mockResolvedValue({
          verified: false,
          errorCode: "delivery_unverified_not_merged",
          reason: "Pull request is open; not merged",
        }),
      };

      const stage = {
        id: "stage-1",
        type: "approval" as const,
        order: 1,
        evidenceRequired: true,
        participants: [],
      };

      await expect(
        verifyStageTerminalEvidence(
          stage,
          { pr: 99, mergedSha: "abc1234567" },
          {
            issue: { id: "i1", companyId: "c1" },
            deliveryVerifier: mockVerifier,
          },
        ),
      ).rejects.toThrow("Pull request is open; not merged");
    });

    it("returns verified receipt when verifier succeeds", async () => {
      const receipt = {
        provider: "github" as const,
        repo: "paperclipai/paperclip",
        pr: 99,
        baseBranch: "master",
        mergedSha: "abc1234567",
        headSha: "abc1234567",
        checksPassed: true,
        verifiedAt: new Date().toISOString(),
      };

      const mockVerifier = {
        verifyTerminalDelivery: vi.fn().mockResolvedValue({
          verified: true,
          receipt,
        }),
      };

      const stage = {
        id: "stage-1",
        type: "approval" as const,
        order: 1,
        evidenceRequired: true,
        participants: [],
      };

      const result = await verifyStageTerminalEvidence(
        stage,
        { pr: 99, mergedSha: "abc1234567" },
        {
          issue: { id: "i1", companyId: "c1" },
          deliveryVerifier: mockVerifier,
        },
      );

      expect(result).toBeDefined();
      expect(result?.verifiedReceipt).toEqual(receipt);
    });

    it("rolls back and ensures no terminal write or decision persistence when delivery verification fails", async () => {
      const mockVerifier = {
        verifyTerminalDelivery: vi.fn().mockResolvedValue({
          verified: false,
          errorCode: "delivery_unverified_head_mismatch",
          reason: "Head SHA mismatch: expected reviewed head abc, but PR head is def. Head movement detected.",
        }),
      };

      const stage = {
        id: "stage-1",
        type: "approval" as const,
        order: 1,
        evidenceRequired: true,
        participants: [],
      };

      let issueStatus = "in_review";
      const decisions: unknown[] = [];

      const executeTerminalTransition = async () => {
        const verified = await verifyStageTerminalEvidence(
          stage,
          { pr: 100, mergedSha: "abc1234567", headSha: "abc" },
          {
            issue: { id: "i1", companyId: "c1" },
            deliveryVerifier: mockVerifier,
          },
        );
        issueStatus = "done";
        decisions.push({ stageId: stage.id, outcome: "approved", evidence: verified?.evidence });
      };

      await expect(executeTerminalTransition()).rejects.toThrow("Head movement detected");
      expect(issueStatus).toBe("in_review");
      expect(decisions).toHaveLength(0);
    });
  });
});

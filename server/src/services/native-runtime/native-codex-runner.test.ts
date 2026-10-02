import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  failAccess: false,
  mockAccessiblePaths: new Set<string>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    accessSync: (path: fs.PathLike, mode?: number) => {
      if (fsMocks.failAccess) {
        throw new Error("ENOENT: no such file or directory");
      }
      if (fsMocks.mockAccessiblePaths.has(String(path))) {
        return undefined;
      }
      return actual.accessSync(path, mode);
    },
  };
});

import type { PaperclipSemanticToolDefinition } from "../../vendor/paperclip-runner/index.js";
import {
  buildNativeRunnerArguments,
  buildNativeRunnerPreparePayload,
  executeNativeCodexRunner,
  resolvePaperclipRunnerBinary,
} from "./native-codex-runner.js";

describe("buildNativeRunnerArguments", () => {
  it("binds every durable identity without exposing the bootstrap ticket", () => {
    const args = buildNativeRunnerArguments({
      connectUrl: "ws://127.0.0.1:3000/api/runner/v1/connect/run-1",
      stateDirectory: "/tmp/runner-state",
      runnerInstanceId: "runner-1",
      environmentLeaseId: "lease-1",
      runId: "run-1",
      normalizedSessionId: "session-1",
      turnId: "turn-1",
      itemId: "item-1",
      runnerDigest: `sha256:${"a".repeat(64)}`,
      maxRuntimeMs: 60_000,
    });
    expect(args).toContain("--connect-url");
    expect(args).toContain("--runner-digest");
    expect(args.join(" ")).not.toContain("bootstrap");
  });
});

const tool: PaperclipSemanticToolDefinition = {
  name: "get_task_context",
  description: "Read the active task context.",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  annotations: {
    semanticContract: "paperclip.semantic-action.v1",
    version: 1,
    placement: "always",
    effect: "read",
    requiredClaims: [],
  },
};

describe("buildNativeRunnerPreparePayload", () => {
  it("binds the coordinator tool projection to run.prepare", () => {
    expect(buildNativeRunnerPreparePayload({
      cwd: "/workspace",
      model: "test-model",
      resumeProviderSessionId: "thread-1",
      completionContract: { revision: "1", criterionIds: ["objective"] },
      semanticTools: [tool],
      providerLaunch: {
        command: "/bin/fake-codex",
        args: ["app-server"],
        providerVersion: "fake-1",
      },
    })).toMatchObject({
      provider: {
        kind: "codex",
        provider: "codex",
        driver: "codex_app_server",
        providerSessionId: "thread-1",
      },
      authorizedTools: {
        schema: "paperclip.runner.authorized-tools.v1",
        schemaVersion: 1,
        catalogDigest:
          "sha256:4e0332535c9e2ff1f5e43089517ee1b46654bfc9cb2ed51efbea4be50db21009",
        operations: [{ operationId: "get_task_context", version: 1 }],
      },
    });
  });
});

describe("resolvePaperclipRunnerBinary", () => {
  it("fails with an explicit error naming the missing binary when no candidate exists", () => {
    fsMocks.failAccess = true;
    try {
      expect(() => resolvePaperclipRunnerBinary(undefined)).toThrowError(
        "paperclip_runner_binary_missing: build @paperclipai/paperclip-runner or set PAPERCLIP_RUNNER_BINARY",
      );
    } finally {
      fsMocks.failAccess = false;
    }
  });

  it("fails when PAPERCLIP_RUNNER_BINARY is not an absolute path", () => {
    expect(() => resolvePaperclipRunnerBinary("relative/path/to/runnerd")).toThrowError(
      "PAPERCLIP_RUNNER_BINARY must be an absolute path",
    );
  });

  it("returns configured binary path when accessible", () => {
    const customBinary =
      process.platform === "win32"
        ? "C:\\bin\\paperclip-runnerd.exe"
        : "/opt/bin/paperclip-runnerd";
    fsMocks.mockAccessiblePaths.add(customBinary);
    try {
      expect(resolvePaperclipRunnerBinary(customBinary)).toBe(customBinary);
    } finally {
      fsMocks.mockAccessiblePaths.delete(customBinary);
    }
  });
});

describe("executeNativeCodexRunner binary resolution error", () => {
  it("fails immediately with explicit missing-binary error without hanging or falling back", async () => {
    fsMocks.failAccess = true;
    try {
      await expect(
        executeNativeCodexRunner({
          db: {} as any,
          companyId: "company-1",
          issueId: "issue-1",
          runId: "run-1",
          agentId: "agent-1",
          runnerInstanceId: "runner-1",
          environmentLeaseId: "lease-1",
          normalizedSessionId: "session-1",
          turnId: "turn-1",
          itemId: "item-1",
          cwd: "/workspace",
          prompt: "test",
          model: null,
          resumeProviderSessionId: null,
          completionContract: { revision: "1", criterionIds: ["objective"] },
          timeoutMs: 1000,
          environment: {},
          onLog: async () => {},
          onSpawn: async () => {},
        }),
      ).rejects.toThrowError(
        "paperclip_runner_binary_missing: build @paperclipai/paperclip-runner or set PAPERCLIP_RUNNER_BINARY",
      );
    } finally {
      fsMocks.failAccess = false;
    }
  });
});


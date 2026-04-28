import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "gemini-session-1", model: "gemini-2.5-pro" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "output_text", text: "hello" }] } }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "gemini-session-1",
        usage: { promptTokenCount: 1, cachedContentTokenCount: 0, candidatesTokenCount: 1 },
        result: "hello",
      }),
    ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "gemini"),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

import { execute } from "./execute.js";

describe("gemini local execution", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("injects SANDBOX_FLAGS when sandbox is enabled", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-gemini-local-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Gemini Builder",
        adapterType: "gemini_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "gemini",
        sandbox: true,
      },
      context: {
        paperclipWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {},
      onLog: async () => {},
    });

    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { env: Record<string, string> }]
      | undefined;
      
    expect(call).toBeDefined();
    const env = call![3].env;
    expect(env.SANDBOX_FLAGS).toBeDefined();
    expect(env.SANDBOX_FLAGS).toContain("-e PAPERCLIP_RUN_ID");
  });
});

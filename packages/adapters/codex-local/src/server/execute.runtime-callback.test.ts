import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The internal runtime callback origin and the public dashboard origin. They are
// deliberately different hosts: an operator that serves the dashboard through a
// tunnel or a tailnet-only hostname leaves the Codex process unable to resolve
// it, so every managed MCP gateway call and every agent callback must go to the
// internal origin instead.
const RUNTIME_ORIGIN = "http://127.0.0.1:3199";
const PUBLIC_DASHBOARD_ORIGIN = "https://dashboard.paperclip.example.test";

const { runAdapterExecutionTargetProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "/usr/bin/codex"),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return { ...actual, runAdapterExecutionTargetProcess };
});

import { execute } from "./execute.js";

const launched: { env: Record<string, string> | null } = { env: null };

runAdapterExecutionTargetProcess.mockImplementation(
  async (
    _runId: string,
    _target: unknown,
    _command: string,
    _args: string[],
    options: { env: Record<string, string> },
  ) => {
    launched.env = options.env;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      pid: 4242,
      startedAt: new Date().toISOString(),
    };
  },
);

describe("codex execute — internal runtime callback endpoint", () => {
  const cleanupDirs: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string): void {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  afterEach(async () => {
    vi.clearAllMocks();
    launched.env = null;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      delete savedEnv[key];
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  /**
   * Drives the real `execute()` CLI path with an external CODEX_HOME so the
   * managed MCP block lands in a temp `config.toml` this test can read back.
   */
  async function runCli(): Promise<{ configToml: string; env: Record<string, string> }> {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-codex-runtime-callback-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHome = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-fixture" }), {
      mode: 0o600,
    });
    setEnv("CODEX_HOME", codexHome);

    await execute({
      runId: "run-runtime-callback",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "codex", engine: "cli", env: { CODEX_HOME: codexHome } },
      context: {
        paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" },
        paperclipManagedMcp: {
          managedMcpOnly: true,
          gateways: [
            { name: "paperclip-assigned", endpointPath: "/mcp/gateways/gw-1", bearerToken: "pcgw_fixture" },
          ],
        },
      },
      onLog: async () => {},
    });

    expect(launched.env).not.toBeNull();
    return {
      configToml: await readFile(path.join(codexHome, "config.toml"), "utf8"),
      env: launched.env!,
    };
  }

  it("points managed MCP gateways at the internal runtime origin, never the public dashboard origin", async () => {
    // The runtime callback origin exists ONLY in the server process environment
    // (this is what `startServer()` writes). Nothing in the agent's adapter
    // config carries it, so a resolver that reads only `config.env` misses it.
    setEnv("PAPERCLIP_RUNTIME_API_URL", RUNTIME_ORIGIN);
    setEnv("PAPERCLIP_API_URL", PUBLIC_DASHBOARD_ORIGIN);

    const { configToml } = await runCli();

    expect(configToml).toContain(`url = "${RUNTIME_ORIGIN}/mcp/gateways/gw-1"`);
    expect(configToml).not.toContain(PUBLIC_DASHBOARD_ORIGIN);
  });

  it("exports the internal runtime origin and the public dashboard origin as distinct child env vars", async () => {
    setEnv("PAPERCLIP_RUNTIME_API_URL", RUNTIME_ORIGIN);
    setEnv("PAPERCLIP_API_URL", PUBLIC_DASHBOARD_ORIGIN);

    const { env } = await runCli();

    expect(env.PAPERCLIP_RUNTIME_API_URL).toBe(RUNTIME_ORIGIN);
    expect(env.PAPERCLIP_API_URL).toBe(PUBLIC_DASHBOARD_ORIGIN);
  });

  it("derives the runtime origin from the listen host and port when no override is configured", async () => {
    // No PAPERCLIP_RUNTIME_API_URL and no PAPERCLIP_API_URL: the callback origin
    // comes from the port the server actually bound, so a non-default port still
    // yields a reachable callback instead of a hard-coded 3100.
    if (!("PAPERCLIP_RUNTIME_API_URL" in savedEnv)) savedEnv.PAPERCLIP_RUNTIME_API_URL = process.env.PAPERCLIP_RUNTIME_API_URL;
    if (!("PAPERCLIP_API_URL" in savedEnv)) savedEnv.PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;
    delete process.env.PAPERCLIP_RUNTIME_API_URL;
    delete process.env.PAPERCLIP_API_URL;
    setEnv("PAPERCLIP_LISTEN_HOST", "127.0.0.1");
    setEnv("PAPERCLIP_LISTEN_PORT", "3177");

    const { configToml, env } = await runCli();

    expect(env.PAPERCLIP_RUNTIME_API_URL).toBe("http://127.0.0.1:3177");
    expect(configToml).toContain('url = "http://127.0.0.1:3177/mcp/gateways/gw-1"');
  });
});

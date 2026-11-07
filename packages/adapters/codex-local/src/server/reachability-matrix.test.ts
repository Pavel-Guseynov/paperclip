import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyAddress,
  detectExecutionNamespace,
  formatReachabilityDiagnostic,
  resolveRuntimeCallbackEndpoint,
  sanitizeUrlForDiagnostics,
  validateRuntimeEndpointReachability,
} from "@paperclipai/adapter-utils";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import type { SshRemoteExecutionSpec } from "@paperclipai/adapter-utils/ssh";
import { execute } from "./execute.js";

const defaultSshSpec: SshRemoteExecutionSpec = {
  host: "container-host",
  port: 22,
  username: "agent",
  remoteCwd: "/remote/workspace",
  remoteWorkspacePath: "/remote/workspace",
  privateKey: null,
  knownHosts: null,
  strictHostKeyChecking: true,
};

describe("Codex runtime reachability matrix", () => {
  const cleanupDirs: string[] = [];
  const originalEnv = { ...process.env };

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function createTestEnv() {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-reachability-matrix-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHome = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "auth.json"), JSON.stringify({
      tokens: { access_token: "test-token", account_id: "test-acc" },
    }), { mode: 0o600 });
    return { rootDir, workspaceDir, codexHome };
  }

  // A CLI run reads its managed MCP bearers from a run-scoped native profile
  // (paperclip-run-<uuid>.config.toml), and Paperclip removes that profile
  // when the run ends. Read it while the stubbed process runs, as Codex would.
  async function stubCodexProcessReadingRunProfile(codexHome: string, stdout: string, pid: number) {
    const executionTargetMod = await import("@paperclipai/adapter-utils/execution-target");
    const seen: { profileName: string | null; profileText: string | null } = { profileName: null, profileText: null };
    const runSpy = vi.spyOn(executionTargetMod, "runAdapterExecutionTargetProcess")
      .mockImplementation(async (_runId, _target, _command, args) => {
        const index = args.indexOf("--profile");
        seen.profileName = index >= 0 ? args[index + 1] ?? null : null;
        seen.profileText = seen.profileName
          ? await readFile(path.join(codexHome, `${seen.profileName}.config.toml`), "utf8")
          : null;
        return { exitCode: 0, signal: null, timedOut: false, stdout, stderr: "", pid,
          startedAt: new Date().toISOString() };
      });
    return { runSpy, seen };
  }

  async function readSharedCodexConfig(codexHome: string): Promise<string> {
    return readFile(path.join(codexHome, "config.toml"), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  }

  describe("Resolution and precedence across execution matrix", () => {
    const modes: Array<"cli" | "acp"> = ["cli", "acp"];
    const namespaces: Array<{
      name: "host-loopback" | "container" | "sandbox";
      target: AdapterExecutionTarget | null;
      localSandbox?: boolean;
      bridgeUrl?: string;
    }> = [
      {
        name: "host-loopback",
        target: { kind: "local" },
      },
      {
        name: "container",
        target: { kind: "remote", transport: "ssh", remoteCwd: "/remote/workspace", spec: defaultSshSpec },
      },
      {
        name: "sandbox",
        target: { kind: "remote", transport: "sandbox", remoteCwd: "/sandbox" },
        bridgeUrl: "http://127.0.0.1:45678",
      },
      {
        name: "sandbox",
        target: { kind: "local" },
        localSandbox: true,
        bridgeUrl: "http://127.0.0.1:45678",
      },
    ];

    for (const mode of modes) {
      for (const ns of namespaces) {
        it(`[${mode.toUpperCase()}] [${ns.name}] honors explicit PAPERCLIP_RUNTIME_API_URL over public dashboard and derived values`, () => {
          const explicitRuntimeUrl = "http://internal-gateway.corp.local:3100";
          const publicDashboardUrl = "https://paperclip.example.com";

          const resolved = resolveRuntimeCallbackEndpoint({
            target: ns.target,
            localSandbox: ns.localSandbox,
            bridgeUrl: ns.bridgeUrl,
            env: {
              PAPERCLIP_RUNTIME_API_URL: explicitRuntimeUrl,
              PAPERCLIP_API_URL: publicDashboardUrl,
            },
          });

          expect(resolved.url).toBe(explicitRuntimeUrl);
          expect(resolved.isExplicit).toBe(true);
          expect(resolved.namespace).toBe(ns.name);
          expect(resolved.url).not.toBe(publicDashboardUrl);
        });

        it(`[${mode.toUpperCase()}] [${ns.name}] never substitutes public PAPERCLIP_API_URL when runtime URL is unset`, () => {
          const publicDashboardUrl = "https://paperclip.example.com";

          const resolved = resolveRuntimeCallbackEndpoint({
            target: ns.target,
            localSandbox: ns.localSandbox,
            bridgeUrl: ns.bridgeUrl,
            listenPort: 3100,
            env: {
              PAPERCLIP_API_URL: publicDashboardUrl,
            },
          });

          expect(resolved.url).not.toBe(publicDashboardUrl);
          expect(resolved.isExplicit).toBe(false);
          expect(resolved.namespace).toBe(ns.name);

          if (ns.name === "host-loopback") {
            expect(resolved.addressClass).toBe("loopback");
            expect(resolved.url).toBe("http://127.0.0.1:3100");
          } else if (ns.name === "container") {
            expect(resolved.addressClass).toBe("container");
            expect(resolved.url).toBe("http://host.docker.internal:3100");
          } else if (ns.name === "sandbox") {
            expect(resolved.addressClass).toBe("sandbox");
            expect(resolved.url).toBe(ns.bridgeUrl);
          }
        });
      }
    }
  });

  describe("Pre-launch reachability probe and fail-fast behavior", () => {
    it("fails CLI execution before launch when container namespace is given a loopback runtime address", async () => {
      const { workspaceDir, codexHome } = await createTestEnv();
      const onLog = vi.fn().mockResolvedValue(undefined);

      const context: AdapterExecutionContext = {
        runId: "run-reachability-fail-cli",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CodexAgent",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: "codex",
          cwd: workspaceDir,
          engine: "cli",
          env: {
            CODEX_HOME: codexHome,
            PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
            PAPERCLIP_API_URL: "https://board.paperclip.test",
          },
        },
        context: {},
        executionTarget: {
          kind: "remote",
          transport: "ssh",
          remoteCwd: "/remote/workspace",
          spec: defaultSshSpec,
        },
        onLog,
      };

      const result = await execute(context);

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe("runtime_api_unreachable");
      expect(result.errorMessage).toContain("unreachable from container network namespace");
      expect(result.resultJson).toMatchObject({
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
        reachability: {
          executionMode: "cli",
          addressClass: "loopback",
          failurePhase: "reachability_probe",
        },
      });

      // Verify secret-safe diagnostics logged to stderr
      expect(onLog).toHaveBeenCalledWith(
        "stderr",
        expect.stringContaining("Runtime reachability failure: executionMode=cli, addressClass=loopback, failurePhase=reachability_probe"),
      );
    });

    it("fails ACP execution before launch when container namespace is given a loopback runtime address", async () => {
      const { workspaceDir, codexHome } = await createTestEnv();
      const onLog = vi.fn().mockResolvedValue(undefined);

      const context: AdapterExecutionContext = {
        runId: "run-reachability-fail-acp",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CodexAgent",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: "codex",
          cwd: workspaceDir,
          engine: "acp",
          env: {
            CODEX_HOME: codexHome,
            PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
            PAPERCLIP_API_URL: "https://board.paperclip.test",
          },
        },
        context: {},
        executionTarget: {
          kind: "remote",
          transport: "ssh",
          remoteCwd: "/remote/workspace",
          spec: defaultSshSpec,
        },
        onLog,
      };

      const result = await execute(context);

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe("runtime_api_unreachable");
      expect(result.errorMessage).toContain("unreachable from container network namespace");
      expect(result.resultJson).toMatchObject({
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
        reachability: {
          executionMode: "acp",
          addressClass: "loopback",
          failurePhase: "reachability_probe",
        },
      });

      expect(onLog).toHaveBeenCalledWith(
        "stderr",
        expect.stringContaining("Runtime reachability failure: executionMode=acp, addressClass=loopback, failurePhase=reachability_probe"),
      );
    });

    it("ensures diagnostics never leak credentials or tokens", () => {
      const sensitiveUrl = "http://token_user:super_secret_pw@internal.service:3100/mcp?auth=token123";
      const sanitized = sanitizeUrlForDiagnostics(sensitiveUrl);
      expect(sanitized).toBe("http://internal.service:3100/mcp");
      expect(sanitized).not.toContain("super_secret_pw");
      expect(sanitized).not.toContain("token_user");
      expect(sanitized).not.toContain("token123");

      const diag = formatReachabilityDiagnostic({
        executionMode: "cli",
        addressClass: "private",
        failurePhase: "reachability_probe",
        endpointUrl: sanitized,
        message: "Connection refused",
      });

      expect(diag).toContain("Runtime reachability failure: executionMode=cli, addressClass=private, failurePhase=reachability_probe");
      expect(diag).toContain("endpoint=http://internal.service:3100/mcp");
      expect(diag).not.toContain("token");
    });
  });

  describe("MCP configuration parity between CLI and ACP modes", () => {
    it("configures managed MCP in CLI mode using resolved runtime API URL", async () => {
      const { workspaceDir, codexHome } = await createTestEnv();
      const runtimeApiUrl = "http://127.0.0.1:3100";
      const publicDashboardUrl = "https://dashboard.paperclip.test";

      // Mock child process execution
      const { runSpy, seen } = await stubCodexProcessReadingRunProfile(codexHome, "Codex finished work", 12345);

      const context: AdapterExecutionContext = {
        runId: "run-mcp-parity-cli",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CodexAgent",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: "codex",
          cwd: workspaceDir,
          engine: "cli",
          env: {
            CODEX_HOME: codexHome,
            PAPERCLIP_RUNTIME_API_URL: runtimeApiUrl,
            PAPERCLIP_API_URL: publicDashboardUrl,
          },
        },
        context: {
          paperclipManagedMcp: {
            version: 1,
            managedMcpOnly: true,
            gateways: [
              {
                id: "gw-1",
                name: "test-gateway",
                endpointPath: "/api/tool-gateway/gateways/gw-1/mcp",
                bearerToken: "pcgw_secret_token_123",
              },
            ],
          },
        },
        executionTarget: { kind: "local" },
        onLog: vi.fn().mockResolvedValue(undefined),
      };

      const result = await execute(context);
      expect(result.exitCode).toBe(0);

      // The run profile selected for Codex carries the managed MCP with the runtime URL.
      expect(seen.profileName).toMatch(/^paperclip-run-[A-Za-z0-9-]+$/);
      expect(seen.profileText).toContain('[mcp_servers."test-gateway"]');
      expect(seen.profileText).toContain(`url = "${runtimeApiUrl}/api/tool-gateway/gateways/gw-1/mcp"`);
      expect(seen.profileText).not.toContain(publicDashboardUrl);
      expect(seen.profileText).toContain('Authorization = "Bearer pcgw_secret_token_123"');
      // The shared config never holds the run bearer, and the run profile is gone after the run.
      expect(await readSharedCodexConfig(codexHome)).not.toContain("pcgw_secret_token_123");
      await expect(readFile(path.join(codexHome, `${seen.profileName}.config.toml`), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });

      // Verify spawned process environment received PAPERCLIP_RUNTIME_API_URL
      expect(runSpy).toHaveBeenCalled();
      const spawnedEnv = runSpy.mock.calls[0][4].env;
      expect(spawnedEnv?.PAPERCLIP_RUNTIME_API_URL).toBe(runtimeApiUrl);
    });

    it("attaches managed MCP gateways and runtime URL in ACP mode", async () => {
      const { workspaceDir, codexHome } = await createTestEnv();
      const runtimeApiUrl = "http://127.0.0.1:3100";
      const publicDashboardUrl = "https://dashboard.paperclip.test";

      const onLog = vi.fn().mockResolvedValue(undefined);
      const context: AdapterExecutionContext = {
        runId: "run-mcp-parity-acp",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CodexAgent",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: "codex",
          cwd: workspaceDir,
          engine: "acp",
          env: {
            CODEX_HOME: codexHome,
            PAPERCLIP_RUNTIME_API_URL: runtimeApiUrl,
            PAPERCLIP_API_URL: publicDashboardUrl,
          },
        },
        context: {
          paperclipManagedMcp: {
            version: 1,
            managedMcpOnly: true,
            gateways: [
              {
                id: "gw-acp-1",
                name: "acp-gateway",
                endpointPath: "/api/tool-gateway/gateways/gw-acp-1/mcp",
                bearerToken: "pcgw_acp_token_456",
              },
            ],
          },
        },
        executionTarget: { kind: "local" },
        onLog,
      };

      const { createCodexAcpExecutor } = await import("./acp.js");
      let capturedContext: any = null;
      const acpExec = createCodexAcpExecutor({
        executor: async (ctx) => {
          capturedContext = ctx;
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            summary: "ACP completed",
            resultJson: {},
          };
        },
      });

      const result = await acpExec(context);
      expect(result.exitCode).toBe(0);

      // ACP supplies managed servers through its native per-session MCP options:
      // the executor receives the run's gateways and the runtime API URL, and the
      // shared Codex config never holds the run bearer.
      expect(capturedContext?.context?.paperclipManagedMcp?.gateways).toEqual([
        expect.objectContaining({ name: "acp-gateway", endpointPath: "/api/tool-gateway/gateways/gw-acp-1/mcp",
          bearerToken: "pcgw_acp_token_456" }),
      ]);
      expect(capturedContext?.config?.env?.PAPERCLIP_RUNTIME_API_URL).toBe(runtimeApiUrl);
      const sharedConfig = await readSharedCodexConfig(codexHome);
      expect(sharedConfig).not.toContain("pcgw_acp_token_456");
      expect(sharedConfig).not.toContain(publicDashboardUrl);
    });
  });

  describe("Isolated workspace fixture test (initialization, auth, MCP, and handoff)", () => {
    it("completes initialization, verified callback reachability, MCP configuration, and clean handoff", async () => {
      const { workspaceDir, codexHome } = await createTestEnv();
      const runtimeApiUrl = "http://127.0.0.1:3100";
      const logs: Array<{ stream: string; message: string }> = [];

      const { seen } = await stubCodexProcessReadingRunProfile(codexHome, "Codex finished task with resolution", 9999);

      const context: AdapterExecutionContext = {
        runId: "run-isolated-fixture-e2e",
        agent: {
          id: "agent-fixture",
          companyId: "company-fixture",
          name: "CodexFixture",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: "task-03" },
        config: {
          command: "codex",
          cwd: workspaceDir,
          engine: "cli",
          filesystemScope: "workspace",
          networkScope: "allowlist",
          networkAllowlist: ["api.openai.com"],
          env: {
            CODEX_HOME: codexHome,
            PAPERCLIP_RUNTIME_API_URL: runtimeApiUrl,
            PAPERCLIP_API_URL: "https://board.paperclip.test",
          },
        },
        context: {
          paperclipManagedMcp: {
            version: 1,
            managedMcpOnly: true,
            gateways: [
              {
                id: "gw-fixture",
                name: "fixture-gateway",
                endpointPath: "/api/tool-gateway/gateways/gw-fixture/mcp",
                bearerToken: "pcgw_fixture_token",
              },
            ],
          },
        },
        executionTarget: {
          kind: "local",
          workspaceRealization: {
            mode: "copy",
            authoritativeRoot: workspaceDir,
            pathAliases: [],
            outboundRestorePaths: [],
          },
        },
        onLog: async (stream, message) => {
          logs.push({ stream, message });
        },
      };

      const result = await execute(context);

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);

      // Verify the run profile carries managed MCP with the internal runtime URL,
      // and the shared config does not hold the run bearer.
      expect(seen.profileText).toContain(`url = "${runtimeApiUrl}/api/tool-gateway/gateways/gw-fixture/mcp"`);
      expect(seen.profileText).toContain('Authorization = "Bearer pcgw_fixture_token"');
      expect(await readSharedCodexConfig(codexHome)).not.toContain("pcgw_fixture_token");

      // Verify logs show confinement and MCP write
      const logText = logs.map((l) => l.message).join("");
      expect(logText).toContain("Wrote 1 managed MCP gateway(s) into Codex config");
      expect(logText).toContain("Confining Codex with workspace filesystem and allowlist network scope");
    });
  });
});

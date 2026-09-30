import { describe, expect, it } from "vitest";
import {
  classifyAddress,
  detectExecutionNamespace,
  formatReachabilityDiagnostic,
  resolveRuntimeCallbackEndpoint,
  sanitizeUrlForDiagnostics,
  validateRuntimeEndpointReachability,
} from "./reachability.js";
import { defaultPathForPlatform } from "./server-utils.js";
import type { AdapterExecutionTarget } from "./execution-target.js";
import type { SshRemoteExecutionSpec } from "./ssh.js";

const defaultSshSpec: SshRemoteExecutionSpec = {
  host: "remote.example.com",
  port: 22,
  username: "user",
  remoteCwd: "/workspace",
  remoteWorkspacePath: "/workspace",
  privateKey: null,
  knownHosts: null,
  strictHostKeyChecking: true,
};

describe("reachability", () => {
  describe("classifyAddress", () => {
    it("classifies loopback IPv4 and hostnames", () => {
      expect(classifyAddress("http://127.0.0.1:3100")).toBe("loopback");
      expect(classifyAddress("http://localhost:3100")).toBe("loopback");
      expect(classifyAddress("http://0.0.0.0:3100")).toBe("loopback");
    });

    it("classifies loopback IPv6", () => {
      expect(classifyAddress("http://[::1]:3100")).toBe("loopback");
      expect(classifyAddress("http://[::]:3100")).toBe("loopback");
    });

    it("classifies container hostnames", () => {
      expect(classifyAddress("http://host.docker.internal:3100")).toBe("container");
      expect(classifyAddress("http://paperclip.internal:3100")).toBe("container");
      expect(classifyAddress("http://paperclip.local:3100")).toBe("container");
      expect(classifyAddress("http://docker:3100")).toBe("container");
      expect(classifyAddress("http://bridge:3100")).toBe("container");
    });

    it("classifies private network addresses", () => {
      expect(classifyAddress("http://10.0.1.5:3100")).toBe("private");
      expect(classifyAddress("http://172.20.0.2:3100")).toBe("private");
      expect(classifyAddress("http://192.168.1.100:3100")).toBe("private");
      expect(classifyAddress("http://100.64.0.1:3100")).toBe("private"); // CGNAT
      expect(classifyAddress("http://[fd00::1]:3100")).toBe("private");
    });

    it("classifies public addresses", () => {
      expect(classifyAddress("https://api.paperclip.ai")).toBe("public");
      expect(classifyAddress("http://8.8.8.8:3100")).toBe("public");
      expect(classifyAddress("http://example.com")).toBe("public");
    });
  });

  describe("sanitizeUrlForDiagnostics", () => {
    it("strips username, password, and tokens from URL", () => {
      expect(
        sanitizeUrlForDiagnostics("http://user:secret-token@127.0.0.1:3100/api/tools?key=secret&token=abc#frag"),
      ).toBe("http://127.0.0.1:3100/api/tools");
    });

    it("handles trailing slashes cleanly", () => {
      expect(sanitizeUrlForDiagnostics("http://127.0.0.1:3100/")).toBe("http://127.0.0.1:3100");
    });
  });

  describe("detectExecutionNamespace", () => {
    it("detects host-loopback for local target or null", () => {
      expect(detectExecutionNamespace({ kind: "local" })).toBe("host-loopback");
      expect(detectExecutionNamespace(null)).toBe("host-loopback");
      expect(detectExecutionNamespace(undefined)).toBe("host-loopback");
    });

    it("detects sandbox for local targets with local sandbox enabled", () => {
      expect(detectExecutionNamespace({ kind: "local" }, { localSandbox: true })).toBe("sandbox");
      expect(detectExecutionNamespace(null, { localSandbox: true })).toBe("sandbox");
    });

    it("detects container for remote SSH target", () => {
      const sshTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "ssh",
        remoteCwd: "/workspace",
        spec: defaultSshSpec,
      };
      expect(detectExecutionNamespace(sshTarget)).toBe("container");
    });

    it("detects sandbox for remote sandbox target", () => {
      const sandboxTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "sandbox",
        remoteCwd: "/workspace",
      };
      expect(detectExecutionNamespace(sandboxTarget)).toBe("sandbox");
    });
  });

  describe("resolveRuntimeCallbackEndpoint", () => {
    it("proves an explicit runtime URL wins over derived values in all namespaces", () => {
      const explicitUrl = "http://internal-host:4000";
      const env = {
        PAPERCLIP_RUNTIME_API_URL: explicitUrl,
        PAPERCLIP_API_URL: "https://public-dashboard.example.com",
        PAPERCLIP_LISTEN_HOST: "127.0.0.1",
        PAPERCLIP_LISTEN_PORT: "3100",
      };

      // In host-loopback namespace
      const localResult = resolveRuntimeCallbackEndpoint({ target: { kind: "local" }, env });
      expect(localResult.url).toBe(explicitUrl);
      expect(localResult.isExplicit).toBe(true);

      // In container namespace
      const sshTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "ssh",
        remoteCwd: "/workspace",
        spec: defaultSshSpec,
      };
      const containerResult = resolveRuntimeCallbackEndpoint({ target: sshTarget, env });
      expect(containerResult.url).toBe(explicitUrl);
      expect(containerResult.isExplicit).toBe(true);

      // In sandbox namespace
      const sandboxTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "sandbox",
        remoteCwd: "/workspace",
      };
      const sandboxResult = resolveRuntimeCallbackEndpoint({
        target: sandboxTarget,
        env,
        bridgeUrl: "http://127.0.0.1:9000",
      });
      expect(sandboxResult.url).toBe(explicitUrl);
      expect(sandboxResult.isExplicit).toBe(true);
    });

    it("proves public and internal URLs remain distinct", () => {
      const env = {
        PAPERCLIP_API_URL: "https://public-dashboard.example.com",
        PAPERCLIP_LISTEN_HOST: "127.0.0.1",
        PAPERCLIP_LISTEN_PORT: "3100",
      };

      const result = resolveRuntimeCallbackEndpoint({ target: { kind: "local" }, env });
      expect(result.url).toBe("http://127.0.0.1:3100");
      expect(result.url).not.toBe(env.PAPERCLIP_API_URL);
      expect(result.addressClass).toBe("loopback");
    });

    it("proves unset value is derived correctly for host-loopback namespace", () => {
      const env = {
        PAPERCLIP_LISTEN_HOST: "0.0.0.0",
        PAPERCLIP_LISTEN_PORT: "3200",
      };
      const result = resolveRuntimeCallbackEndpoint({ target: { kind: "local" }, env });
      expect(result.url).toBe("http://127.0.0.1:3200");
      expect(result.addressClass).toBe("loopback");
      expect(result.namespace).toBe("host-loopback");
    });

    it("proves unset value is derived correctly for container namespace", () => {
      const sshTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "ssh",
        remoteCwd: "/workspace",
        spec: defaultSshSpec,
      };

      // With candidates
      const envWithCandidates = {
        PAPERCLIP_LISTEN_PORT: "3100",
        PAPERCLIP_RUNTIME_API_CANDIDATES_JSON: JSON.stringify([
          "http://127.0.0.1:3100",
          "http://192.168.1.50:3100",
        ]),
      };
      const resultFromCandidates = resolveRuntimeCallbackEndpoint({
        target: sshTarget,
        env: envWithCandidates,
      });
      expect(resultFromCandidates.url).toBe("http://192.168.1.50:3100");
      expect(resultFromCandidates.addressClass).toBe("private");
      expect(resultFromCandidates.namespace).toBe("container");

      // Without candidates, falls back to host.docker.internal
      const envDefault = {
        PAPERCLIP_LISTEN_PORT: "3100",
      };
      const resultDefault = resolveRuntimeCallbackEndpoint({
        target: sshTarget,
        env: envDefault,
      });
      expect(resultDefault.url).toBe("http://host.docker.internal:3100");
      expect(resultDefault.addressClass).toBe("container");
      expect(resultDefault.namespace).toBe("container");
    });

    it("proves unset value is derived correctly for sandbox namespace", () => {
      const sandboxTarget: AdapterExecutionTarget = {
        kind: "remote",
        transport: "sandbox",
        remoteCwd: "/workspace",
      };

      const result = resolveRuntimeCallbackEndpoint({
        target: sandboxTarget,
        bridgeUrl: "http://127.0.0.1:4567",
      });
      expect(result.url).toBe("http://127.0.0.1:4567");
      expect(result.addressClass).toBe("sandbox");
      expect(result.namespace).toBe("sandbox");
    });
  });

  describe("validateRuntimeEndpointReachability", () => {
    it("proves an unreachable loopback endpoint fails for container namespace before useful work", async () => {
      const containerEndpoint = {
        url: "http://127.0.0.1:3100",
        addressClass: "loopback" as const,
        isExplicit: true,
        namespace: "container" as const,
      };

      const validation = await validateRuntimeEndpointReachability({
        endpoint: containerEndpoint,
        executionMode: "cli",
      });

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.diagnostic.executionMode).toBe("cli");
        expect(validation.diagnostic.addressClass).toBe("loopback");
        expect(validation.diagnostic.failurePhase).toBe("reachability_probe");
        expect(validation.diagnostic.message).toContain("unreachable from container network namespace");
        // Secret safety check: no auth tokens or credentials
        expect(formatReachabilityDiagnostic(validation.diagnostic)).not.toContain("token");
      }
    });

    it("proves a probe failure reports structured diagnostics without falling back to loopback", async () => {
      const sshEndpoint = {
        url: "http://unreachable-host.internal:3100",
        addressClass: "container" as const,
        isExplicit: false,
        namespace: "container" as const,
      };

      const validation = await validateRuntimeEndpointReachability({
        endpoint: sshEndpoint,
        executionMode: "acp",
        probeFn: async () => false,
      });

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.diagnostic.executionMode).toBe("acp");
        expect(validation.diagnostic.addressClass).toBe("container");
        expect(validation.diagnostic.failurePhase).toBe("reachability_probe");
        expect(validation.diagnostic.message).toContain("failed reachability probe");
      }
    });

    it("passes when probe succeeds", async () => {
      const validEndpoint = {
        url: "http://host.docker.internal:3100",
        addressClass: "container" as const,
        isExplicit: false,
        namespace: "container" as const,
      };

      const validation = await validateRuntimeEndpointReachability({
        endpoint: validEndpoint,
        executionMode: "cli",
        probeFn: async () => true,
      });

      expect(validation.ok).toBe(true);
    });
  });

  describe("formatReachabilityDiagnostic", () => {
    it("formats secret-safe diagnostics with executionMode, addressClass, and failurePhase", () => {
      const formatted = formatReachabilityDiagnostic({
        executionMode: "cli",
        addressClass: "loopback",
        failurePhase: "reachability_probe",
        endpointUrl: "http://127.0.0.1:3100",
        message: "Endpoint unreachable from container.",
      });

      expect(formatted).toBe(
        '[paperclip] Runtime reachability failure: executionMode=cli, addressClass=loopback, failurePhase=reachability_probe (endpoint=http://127.0.0.1:3100). Endpoint unreachable from container.',
      );
    });
  });

  describe("defaultPathForPlatform", () => {
    it("includes stable profile link /run/current-system/sw/bin on POSIX", () => {
      const p = defaultPathForPlatform();
      if (process.platform === "win32") {
        expect(p).toContain("System32");
      } else {
        expect(p).toContain("/run/current-system/sw/bin");
      }
    });
  });
});

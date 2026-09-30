import { URL } from "node:url";
import type { AdapterExecutionTarget } from "./execution-target.js";

export type AddressClass = "loopback" | "container" | "sandbox" | "private" | "public";
export type ExecutionNamespace = "host-loopback" | "container" | "sandbox";
export type ReachabilityFailurePhase =
  | "pre_launch"
  | "endpoint_resolution"
  | "reachability_probe"
  | "mcp_registration"
  | "session_initialization"
  | "handoff";

export interface ResolvedRuntimeCallbackEndpoint {
  url: string;
  addressClass: AddressClass;
  isExplicit: boolean;
  namespace: ExecutionNamespace;
}

export interface RuntimeReachabilityDiagnostics {
  executionMode: "cli" | "acp";
  addressClass: AddressClass;
  failurePhase: ReachabilityFailurePhase;
  endpointUrl?: string;
  message: string;
  detail?: string | null;
}

export type ReachabilityValidationResult =
  | { ok: true; endpoint: ResolvedRuntimeCallbackEndpoint }
  | { ok: false; diagnostic: RuntimeReachabilityDiagnostics };

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0.0.0.0",
  "::",
  "[::]",
]);

/**
 * Strips credentials, tokens, and query strings from a URL so diagnostics never
 * leak secrets or userinfo.
 */
export function sanitizeUrlForDiagnostics(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return rawUrl
      .replace(/:\/\/([^:@]+):([^@]+)@/g, "://")
      .replace(/\?.*$/g, "")
      .replace(/#.*$/g, "")
      .trim();
  }
}

/**
 * Classifies an endpoint URL into an address category.
 */
export function classifyAddress(rawUrl: string): AddressClass {
  try {
    const parsed = new URL(rawUrl.trim());
    const hostname = parsed.hostname.toLowerCase();
    const unbracketed = hostname.replace(/^\[|\]$/g, "");

    if (LOOPBACK_HOSTS.has(hostname) || LOOPBACK_HOSTS.has(unbracketed)) {
      return "loopback";
    }


    if (
      hostname === "host.docker.internal" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname === "docker" ||
      hostname === "bridge"
    ) {
      return "container";
    }

    // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT)
    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4Match) {
      const b0 = Number(ipv4Match[1]);
      const b1 = Number(ipv4Match[2]);
      if (b0 === 127) return "loopback";
      if (b0 === 10) return "private";
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return "private";
      if (b0 === 192 && b1 === 168) return "private";
      if (b0 === 100 && b1 >= 64 && b1 <= 127) return "private";
      return "public";
    }

    // IPv6 Unique Local Addresses (fc00::/7 -> fc.. or fd..)
    if (/^\[?(?:fc|fd)[0-9a-f]{2}:/i.test(hostname)) {
      return "private";
    }

    return "public";
  } catch {
    return "public";
  }
}

/**
 * Detects the execution network namespace from the execution target and local sandbox settings.
 */
export function detectExecutionNamespace(
  target?: AdapterExecutionTarget | null,
  options?: { localSandbox?: boolean },
): ExecutionNamespace {
  if (options?.localSandbox) {
    return "sandbox";
  }
  if (target?.kind === "remote") {
    if (target.transport === "sandbox") {
      return "sandbox";
    }
    if (target.transport === "ssh") {
      return "container";
    }
  }
  return "host-loopback";
}

function normalizeListenHost(rawHost?: string | null): string {
  const host = rawHost?.trim();
  if (!host || host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) {
    return `[${host}]`;
  }
  return host;
}

/**
 * Resolves the internal runtime callback endpoint at the execution-environment boundary.
 *
 * Precedence:
 * 1. An explicitly configured `PAPERCLIP_RUNTIME_API_URL` (non-empty) always wins across all namespaces.
 * 2. When unset, derives the endpoint for the specific execution namespace:
 *    - sandbox: uses the sandbox callback bridge URL.
 *    - container: derives a host-reachable address (e.g. candidate or host.docker.internal).
 *    - host-loopback: derives `http://${listenHost}:${listenPort}`.
 *
 * A public dashboard URL (`PAPERCLIP_API_URL`) is never substituted for the agent callback URL.
 */
export function resolveRuntimeCallbackEndpoint(input: {
  target?: AdapterExecutionTarget | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  bridgeUrl?: string | null;
  localSandbox?: boolean;
  listenHost?: string | null;
  listenPort?: string | number | null;
  candidates?: string[] | null;
}): ResolvedRuntimeCallbackEndpoint {
  const env = input.env ?? process.env;
  const namespace = detectExecutionNamespace(input.target, { localSandbox: input.localSandbox });

  const explicitRuntimeUrl = env.PAPERCLIP_RUNTIME_API_URL?.trim();
  if (explicitRuntimeUrl && explicitRuntimeUrl.length > 0) {
    return {
      url: explicitRuntimeUrl.replace(/\/+$/, ""),
      addressClass: classifyAddress(explicitRuntimeUrl),
      isExplicit: true,
      namespace,
    };
  }

  const port = String(input.listenPort ?? env.PAPERCLIP_LISTEN_PORT ?? env.PORT ?? "3100");
  const host = normalizeListenHost(input.listenHost ?? env.PAPERCLIP_LISTEN_HOST ?? env.HOST);

  if (namespace === "sandbox") {
    if (input.bridgeUrl?.trim()) {
      const bridgeUrl = input.bridgeUrl.trim().replace(/\/+$/, "");
      return {
        url: bridgeUrl,
        addressClass: "sandbox",
        isExplicit: false,
        namespace,
      };
    }
  }

  if (namespace === "container") {
    let candidateUrls: string[] = [];
    if (input.candidates && input.candidates.length > 0) {
      candidateUrls = input.candidates;
    } else if (env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON) {
      try {
        candidateUrls = JSON.parse(env.PAPERCLIP_RUNTIME_API_CANDIDATES_JSON);
      } catch {
        candidateUrls = [];
      }
    }

    const nonLoopbackCandidate = candidateUrls.find((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return false;
      const addrClass = classifyAddress(trimmed);
      return addrClass !== "loopback";
    });

    if (nonLoopbackCandidate) {
      const url = nonLoopbackCandidate.trim().replace(/\/+$/, "");
      return {
        url,
        addressClass: classifyAddress(url),
        isExplicit: false,
        namespace,
      };
    }

    const containerHostUrl = `http://host.docker.internal:${port}`;
    return {
      url: containerHostUrl,
      addressClass: "container",
      isExplicit: false,
      namespace,
    };
  }

  const derivedUrl = `http://${host}:${port}`;
  return {
    url: derivedUrl,
    addressClass: classifyAddress(derivedUrl),
    isExplicit: false,
    namespace,
  };
}

/**
 * Validates that the resolved internal runtime endpoint is reachable from the target namespace
 * before useful execution work begins.
 *
 * In particular, container namespaces given loopback addresses or unreachable hosts fail
 * immediately rather than silently falling back to loopback.
 */
export async function validateRuntimeEndpointReachability(input: {
  endpoint: ResolvedRuntimeCallbackEndpoint;
  executionMode: "cli" | "acp";
  probeFn?: (url: string) => Promise<boolean>;
}): Promise<ReachabilityValidationResult> {
  const { endpoint, executionMode, probeFn } = input;
  const sanitizedUrl = sanitizeUrlForDiagnostics(endpoint.url);

  if (endpoint.namespace === "container" && endpoint.addressClass === "loopback") {
    return {
      ok: false,
      diagnostic: {
        executionMode,
        addressClass: endpoint.addressClass,
        failurePhase: "reachability_probe",
        endpointUrl: sanitizedUrl,
        message: `Loopback address "${sanitizedUrl}" is unreachable from container network namespace. Configure PAPERCLIP_RUNTIME_API_URL with a host-reachable address.`,
      },
    };
  }

  if (probeFn) {
    try {
      const reachable = await probeFn(endpoint.url);
      if (!reachable) {
        return {
          ok: false,
          diagnostic: {
            executionMode,
            addressClass: endpoint.addressClass,
            failurePhase: "reachability_probe",
            endpointUrl: sanitizedUrl,
            message: `Runtime API endpoint "${sanitizedUrl}" failed reachability probe from ${endpoint.namespace} namespace.`,
          },
        };
      }
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          executionMode,
          addressClass: endpoint.addressClass,
          failurePhase: "reachability_probe",
          endpointUrl: sanitizedUrl,
          message: `Runtime API reachability probe error: ${error instanceof Error ? error.message : String(error)}`,
          detail: error instanceof Error ? error.stack : null,
        },
      };
    }
  }

  return { ok: true, endpoint };
}

/**
 * Formats a secret-safe diagnostic message for logs or structured error responses.
 */
export function formatReachabilityDiagnostic(diag: RuntimeReachabilityDiagnostics): string {
  const urlPart = diag.endpointUrl ? ` (endpoint=${diag.endpointUrl})` : "";
  return `[paperclip] Runtime reachability failure: executionMode=${diag.executionMode}, addressClass=${diag.addressClass}, failurePhase=${diag.failurePhase}${urlPart}. ${diag.message}`;
}

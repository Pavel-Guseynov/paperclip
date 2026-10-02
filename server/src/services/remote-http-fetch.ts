import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { Readable } from "node:stream";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import {
  assertProxiedRemoteHttpEndpoint,
  isAlwaysDeniedLinkLocalIp,
  isPrivateOrReservedIp,
  normalizeIpAddress,
  parseRemoteHttpProxy,
  resolveApprovedRemoteHttpAddresses,
  type RemoteHttpEndpointErrorFactory,
  type RemoteHttpEndpointGuardOptions,
} from "./remote-http-endpoint-guard.js";

/** Statuses whose HTTP semantics forbid a response body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Stands in for undici's `headersTimeout`/`bodyTimeout`, which the platform
 * `fetch` applied for free. Without it a remote server that accepts the
 * connection and then stays silent would hold the request open indefinitely —
 * the OAuth callers pass no `AbortSignal`, so nothing else would ever cut it
 * loose (PAP-17110).
 *
 * Deliberately far tighter than undici's 300 s: everything that reaches this
 * transport is metadata discovery, a token exchange, a DCR call or an MCP
 * JSON-RPC round trip, none of which has any business taking minutes. Callers
 * that own a longer budget — `tools/call`, which an operator can raise to 60 s —
 * pass `responseTimeoutMs` so this default never truncates it.
 */
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const DNS_RESOLUTION_ERROR_CODES = new Set(["ENODATA", "ENOTFOUND", "EAI_AGAIN"]);

/** How a verified socket is opened. Overridable so tests can simulate a rebind. */
export type RemoteHttpSocketFactory = (target: {
  address: string;
  port: number;
  hostname: string;
  useTls: boolean;
}) => Socket;

export type GuardedRemoteHttpFetchOptions = RemoteHttpEndpointGuardOptions & {
  /** Builds the rejection thrown when the guard or the peer check fails. */
  error: RemoteHttpEndpointErrorFactory;
  /**
   * Test seam: opens the raw TCP socket. Production leaves this unset so the
   * socket is dialled at the approved address. A factory that connects
   * somewhere else stands in for a rebind below the DNS layer, and must still
   * be caught by the peer-address check.
   */
  socketFactory?: RemoteHttpSocketFactory;
  connectTimeoutMs?: number;
  /** Deadline for response headers, and idle deadline between body chunks. */
  responseTimeoutMs?: number;
  /**
   * Platform `fetch`, used only for IP literals, which cannot be rebound.
   */
  unpinnedFetch?: typeof fetch;
  /** Optional SOCKS5 proxy URL (socks5h://host:port). */
  proxy?: string | URL | null;
};

/**
 * Fetch a remote endpoint without reopening the DNS-rebinding window the guard
 * just closed (PAP-17098).
 *
 * `assertPublicRemoteHttpEndpoint` used to hand its verdict to a bare global
 * `fetch`, which resolved the hostname a second time. An attacker who controls
 * the name server for the hostname could answer with a public address for the
 * guard's lookup and a loopback, RFC 1918 or link-local address for the
 * connection, reaching internal services and cloud metadata from the Paperclip
 * server. This function instead:
 *
 * 1. resolves and validates the hostname exactly once, keeping the approved
 *    address set;
 * 2. dials one of those approved addresses directly, so the socket layer never
 *    performs its own lookup;
 * 3. preserves the original hostname for the `Host` header, for TLS SNI and for
 *    certificate identity checking, so pinning is invisible to the peer;
 * 4. re-checks the address the socket actually connected to before a single
 *    request byte is written, which also covers a rebind below DNS; and
 * 5. never follows redirects — it behaves as `redirect: "manual"` so the caller
 *    re-runs the whole guard against every `Location` it decides to follow.
 *
 * URLs that already carry an IP literal need no pinning and keep platform
 * `fetch` semantics: no name resolution happens on
 *   either side of the guard, so there is no second answer to disagree with the
 *   first. `URL` has already normalised the literal (`0x7f.1`, `::ffff:7f00:1`)
 *   by the time the guard classifies it.
 */
export async function guardedRemoteHttpFetch(
  url: string | URL,
  init: RequestInit,
  options: GuardedRemoteHttpFetchOptions,
): Promise<Response> {
  const endpoint = url instanceof URL ? url : new URL(url);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw options.error("Remote MCP connection URL must use http or https", "mcp_remote_url_invalid");
  }

  const proxyUrl = parseRemoteHttpProxy(options.proxy, options.error);
  if (proxyUrl) {
    assertProxiedRemoteHttpEndpoint(endpoint, options, options.error);
    return proxiedRequest(endpoint, proxyUrl, init, options);
  }

  const approved = await resolveApprovedRemoteHttpAddresses(endpoint, options, options.error);
  const literalHost = isIP(endpoint.hostname.replace(/^\[|\]$/g, "")) !== 0;
  const platformFetch = options.unpinnedFetch ?? fetch;
  if (literalHost) {
    try {
      return await platformFetch(endpoint.toString(), { ...init, redirect: "manual" });
    } catch (error) {
      if (isDnsResolutionError(error)) {
        throw options.error(
          "Remote MCP connection hostname could not be resolved",
          "remote_http_dns_failed",
        );
      }
      throw error;
    }
  }
  return pinnedRequest(endpoint, approved, init, options);
}

/** Node's platform fetch wraps DNS failures in TypeError.cause. */
function isDnsResolutionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string" && DNS_RESOLUTION_ERROR_CODES.has(record.code)) return true;
    current = record.cause;
  }
  return false;
}

async function proxiedRequest(
  endpoint: URL,
  proxyUrl: URL,
  init: RequestInit,
  options: GuardedRemoteHttpFetchOptions,
): Promise<Response> {
  const useTls = endpoint.protocol === "https:";
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const port = endpoint.port ? Number(endpoint.port) : useTls ? 443 : 80;
  const signal = init.signal ?? null;

  signal?.throwIfAborted?.();

  const socket = await openProxiedSocket({
    endpoint,
    proxyUrl,
    hostname,
    port,
    useTls,
    signal,
    options,
  });

  try {
    return await sendRequest({
      endpoint,
      hostname,
      port,
      useTls,
      socket,
      init,
      signal,
      responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
      error: options.error,
    });
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function openProxiedSocket(input: {
  endpoint: URL;
  proxyUrl: URL;
  hostname: string;
  port: number;
  useTls: boolean;
  signal: AbortSignal | null;
  options: GuardedRemoteHttpFetchOptions;
}): Promise<Socket | TLSSocket> {
  const { proxyUrl, hostname, port, useTls, signal, options } = input;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const proxyHost = proxyUrl.hostname.replace(/^\[|\]$/g, "");
  const proxyPort = proxyUrl.port ? Number(proxyUrl.port) : 1080;

  const factory = options.socketFactory
    ?? ((target) => netConnect({ host: target.address, port: target.port }));

  const raw = factory({
    address: proxyHost,
    port: proxyPort,
    hostname: proxyHost,
    useTls: false,
  });

  try {
    await once(raw, "connect", { signal, timeoutMs: connectTimeoutMs, what: "connect to proxy" });
  } catch (error) {
    raw.destroy();
    if (signal?.aborted) throw error;
    throw options.error("Remote MCP proxy could not be reached", "remote_http_connect_failed");
  }

  try {
    await performSocks5Handshake({
      socket: raw,
      targetHost: hostname,
      targetPort: port,
      proxyUrl,
      timeoutMs: connectTimeoutMs,
      signal,
      error: options.error,
    });
  } catch (error) {
    raw.destroy();
    if (signal?.aborted) throw error;
    throw error;
  }

  if (!useTls) return raw;

  const secure = tlsConnect({
    socket: raw,
    servername: isIP(hostname) === 0 ? hostname : undefined,
    host: hostname,
  });
  try {
    await once(secure, "secureConnect", { signal, timeoutMs: connectTimeoutMs, what: "negotiate TLS with" });
  } catch (error) {
    secure.destroy();
    raw.destroy();
    if (signal?.aborted) throw error;
    throw options.error("Remote MCP TLS handshake failed", "remote_http_connect_failed");
  }
  return secure;
}

class Socks5SocketReader {
  private buffer = Buffer.alloc(0);
  private closed = false;
  private error: Error | null = null;
  private waiter: {
    count: number;
    resolve: (buf: Buffer) => void;
    reject: (err: Error) => void;
  } | null = null;
  private onData: (chunk: Buffer) => void;
  private onError: (err: Error) => void;
  private onClose: () => void;

  constructor(
    private readonly socket: Socket,
    private readonly errorFactory: RemoteHttpEndpointErrorFactory,
  ) {
    this.onData = (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.checkWaiter();
    };
    this.onError = (err: Error) => {
      this.error = err;
      if (this.waiter) {
        const { reject } = this.waiter;
        this.waiter = null;
        reject(err);
      }
    };
    this.onClose = () => {
      this.closed = true;
      if (this.waiter) {
        const { reject } = this.waiter;
        this.waiter = null;
        reject(
          this.errorFactory(
            "Remote MCP proxy closed connection unexpectedly",
            "remote_http_proxy_failed",
          ),
        );
      }
    };

    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
    socket.on("end", this.onClose);
  }

  private checkWaiter() {
    if (this.waiter && this.buffer.length >= this.waiter.count) {
      const { count, resolve } = this.waiter;
      this.waiter = null;
      const result = this.buffer.subarray(0, count);
      this.buffer = this.buffer.subarray(count);
      resolve(result);
    }
  }

  readExact(
    count: number,
    timeoutMs: number,
    signal: AbortSignal | null,
  ): Promise<Buffer> {
    if (this.buffer.length >= count) {
      const result = this.buffer.subarray(0, count);
      this.buffer = this.buffer.subarray(count);
      return Promise.resolve(result);
    }
    if (this.error) return Promise.reject(this.error);
    if (this.closed) {
      return Promise.reject(
        this.errorFactory(
          "Remote MCP proxy closed connection unexpectedly",
          "remote_http_proxy_failed",
        ),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("Aborted"));
    }

    return new Promise<Buffer>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      };

      if (signal) {
        onAbort = () => {
          cleanup();
          if (this.waiter) this.waiter = null;
          reject(signal.reason ?? new Error("Aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      timer = setTimeout(() => {
        cleanup();
        if (this.waiter) this.waiter = null;
        reject(
          this.errorFactory(
            "Remote MCP proxy handshake timed out",
            "remote_http_response_timeout",
          ),
        );
      }, timeoutMs);
      timer.unref?.();

      this.waiter = {
        count,
        resolve: (b) => {
          cleanup();
          resolve(b);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };
    });
  }

  destroy() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    this.socket.off("end", this.onClose);
    if (this.buffer.length > 0) {
      this.socket.unshift(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
  }
}

function parseIpv6AddressBytes(address: string): Buffer {
  const parts = address.toLowerCase().split("::");
  const left = parts[0] ? parts[0].split(":").filter(Boolean).map((h) => Number.parseInt(h, 16)) : [];
  const right = parts[1] ? parts[1].split(":").filter(Boolean).map((h) => Number.parseInt(h, 16)) : [];
  const middleLen = 8 - (left.length + right.length);
  const middle = Array(middleLen > 0 ? middleLen : 0).fill(0);
  const words = [...left, ...middle, ...right];
  const buf = Buffer.alloc(16);
  words.forEach((w, i) => buf.writeUInt16BE(w, i * 2));
  return buf;
}

async function performSocks5Handshake(input: {
  socket: Socket;
  targetHost: string;
  targetPort: number;
  proxyUrl: URL;
  timeoutMs: number;
  signal: AbortSignal | null;
  error: RemoteHttpEndpointErrorFactory;
}): Promise<void> {
  const { socket, targetHost, targetPort, proxyUrl, timeoutMs, signal, error } = input;
  const reader = new Socks5SocketReader(socket, error);
  try {
    const hasAuth = Boolean(proxyUrl.username || proxyUrl.password);

    const greeting = hasAuth
      ? Buffer.from([0x05, 0x02, 0x00, 0x02])
      : Buffer.from([0x05, 0x01, 0x00]);
    socket.write(greeting);

    const greetingResp = await reader.readExact(2, timeoutMs, signal);
    if (greetingResp[0] !== 0x05) {
      throw error("Invalid SOCKS5 proxy version", "remote_http_proxy_failed");
    }
    const method = greetingResp[1];
    if (method === 0x02 && hasAuth) {
      const userBuf = Buffer.from(decodeURIComponent(proxyUrl.username), "utf8");
      const passBuf = Buffer.from(decodeURIComponent(proxyUrl.password), "utf8");
      const authReq = Buffer.concat([
        Buffer.from([0x01, userBuf.length]),
        userBuf,
        Buffer.from([passBuf.length]),
        passBuf,
      ]);
      socket.write(authReq);
      const authResp = await reader.readExact(2, timeoutMs, signal);
      if (authResp[0] !== 0x01 || authResp[1] !== 0x00) {
        throw error("SOCKS5 proxy authentication failed", "remote_http_proxy_failed");
      }
    } else if (method !== 0x00) {
      throw error("SOCKS5 proxy authentication method rejected", "remote_http_proxy_failed");
    }

    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(targetPort);

    const ipVer = isIP(targetHost);
    let addrBuf: Buffer;
    if (ipVer === 4) {
      const octets = targetHost.split(".").map(Number);
      addrBuf = Buffer.concat([Buffer.from([0x01]), Buffer.from(octets)]);
    } else if (ipVer === 6) {
      addrBuf = Buffer.concat([Buffer.from([0x04]), parseIpv6AddressBytes(targetHost)]);
    } else {
      const hostBytes = Buffer.from(targetHost, "utf8");
      addrBuf = Buffer.concat([Buffer.from([0x03, hostBytes.length]), hostBytes]);
    }

    const connectReq = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      addrBuf,
      portBuf,
    ]);
    socket.write(connectReq);

    const head = await reader.readExact(4, timeoutMs, signal);
    if (head[0] !== 0x05) {
      throw error("Invalid SOCKS5 proxy version in connect reply", "remote_http_proxy_failed");
    }
    const rep = head[1];
    if (rep !== 0x00) {
      throw error(`SOCKS5 proxy connect failed with code ${rep}`, "remote_http_proxy_failed");
    }
    const atyp = head[3];
    if (atyp === 0x01) {
      await reader.readExact(4 + 2, timeoutMs, signal);
    } else if (atyp === 0x04) {
      await reader.readExact(16 + 2, timeoutMs, signal);
    } else if (atyp === 0x03) {
      const lenBuf = await reader.readExact(1, timeoutMs, signal);
      await reader.readExact(lenBuf[0]! + 2, timeoutMs, signal);
    } else {
      throw error("Invalid address type in SOCKS5 proxy connect reply", "remote_http_proxy_failed");
    }
  } finally {
    reader.destroy();
  }
}

async function pinnedRequest(
  endpoint: URL,
  approved: string[],
  init: RequestInit,
  options: GuardedRemoteHttpFetchOptions,
): Promise<Response> {
  const useTls = endpoint.protocol === "https:";
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const port = endpoint.port ? Number(endpoint.port) : useTls ? 443 : 80;
  const approvedSet = new Set(approved.map(normalizeIpAddress));
  const signal = init.signal ?? null;

  signal?.throwIfAborted?.();

  const socket = await dialApprovedAddress({ approved, approvedSet, port, hostname, useTls, signal, options });

  try {
    return await sendRequest({
      endpoint,
      hostname,
      port,
      useTls,
      socket,
      init,
      signal,
      responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
      error: options.error,
    });
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/** An approved address that could not be reached, so the next one may be tried. */
class UnreachableAddressError extends Error {
  constructor(readonly reason: unknown) {
    super("Remote MCP approved address was unreachable");
  }
}

/**
 * Try the approved addresses in resolution order.
 *
 * `fetch` walks every A/AAAA record before giving up, so pinning to `approved[0]`
 * alone would break a multi-homed host whose first record happens to be dead. A
 * peer that fails the address check is a different matter — that is the rebinding
 * defence firing, not a reachability problem — so it fails closed immediately
 * rather than moving down the list.
 */
async function dialApprovedAddress(input: {
  approved: string[];
  approvedSet: Set<string>;
  port: number;
  hostname: string;
  useTls: boolean;
  signal: AbortSignal | null;
  options: GuardedRemoteHttpFetchOptions;
}): Promise<Socket | TLSSocket> {
  let lastReason: unknown;
  for (const address of input.approved) {
    input.signal?.throwIfAborted?.();
    try {
      return await openVerifiedSocket({ ...input, address });
    } catch (error) {
      if (!(error instanceof UnreachableAddressError)) throw error;
      lastReason = error.reason;
    }
  }
  throw lastReason
    ?? input.options.error("Remote MCP endpoint could not be reached", "remote_http_connect_failed");
}

/**
 * Connect to `address`, confirm the peer really is that approved address, and
 * only then complete the TLS handshake. Verifying before the handshake keeps
 * even a ClientHello off an internal service.
 */
async function openVerifiedSocket(input: {
  address: string;
  approvedSet: Set<string>;
  port: number;
  hostname: string;
  useTls: boolean;
  signal: AbortSignal | null;
  options: GuardedRemoteHttpFetchOptions;
}): Promise<Socket | TLSSocket> {
  const { address, approvedSet, port, hostname, useTls, signal, options } = input;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const factory = options.socketFactory
    ?? ((target) => netConnect({ host: target.address, port: target.port }));

  const raw = factory({ address, port, hostname, useTls });

  try {
    await once(raw, "connect", { signal, timeoutMs: connectTimeoutMs, what: "connect to" });
  } catch (error) {
    // A connect timeout used to leave the half-open socket behind, because
    // nothing above this point owns it yet.
    raw.destroy();
    if (signal?.aborted) throw error;
    throw new UnreachableAddressError(error);
  }

  const peer = raw.remoteAddress ? normalizeIpAddress(raw.remoteAddress) : null;
  const peerDenied = peer && (
    isAlwaysDeniedLinkLocalIp(peer)
    || (!options.allowPrivateNetwork && isPrivateOrReservedIp(peer))
  );
  if (!peer || peerDenied || !approvedSet.has(peer)) {
    raw.destroy();
    throw options.error(
      "Remote MCP connection resolved to an address that was not approved",
      "remote_http_private_endpoint",
    );
  }

  if (!useTls) return raw;

  const secure = tlsConnect({
    socket: raw,
    // The certificate is checked against the hostname the operator configured,
    // not the pinned address, and SNI carries that hostname too.
    servername: isIP(hostname) === 0 ? hostname : undefined,
    host: hostname,
  });
  try {
    await once(secure, "secureConnect", { signal, timeoutMs: connectTimeoutMs, what: "negotiate TLS with" });
  } catch (error) {
    secure.destroy();
    raw.destroy();
    if (signal?.aborted) throw error;
    throw new UnreachableAddressError(error);
  }
  return secure;
}

async function sendRequest(input: {
  endpoint: URL;
  hostname: string;
  port: number;
  useTls: boolean;
  socket: Socket;
  init: RequestInit;
  signal: AbortSignal | null;
  responseTimeoutMs: number;
  error: RemoteHttpEndpointErrorFactory;
}): Promise<Response> {
  const { endpoint, hostname, port, useTls, socket, init, signal, responseTimeoutMs, error } = input;
  const headers = new Headers(init.headers);
  const body = readRequestBody(init.body);
  const method = (init.method ?? "GET").toUpperCase();

  // Raw node:http requests do not add the default User-Agent that `fetch` and
  // curl send. Some provider CDNs reject an absent User-Agent before the MCP or
  // OAuth service sees the request (Coda returns 403 instead of its 401 OAuth
  // challenge), so give every guarded request a stable, non-identifying client
  // token while preserving an explicit caller value.
  if (!headers.has("user-agent")) headers.set("user-agent", "Paperclip/1.0");
  if (body !== undefined && !headers.has("content-length") && !headers.has("transfer-encoding")) {
    headers.set("content-length", String(body.byteLength));
  }
  if (init.body instanceof URLSearchParams && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  }
  // `URL.host` already drops the port when it is the protocol default, so the
  // peer sees the same `Host` a plain `fetch` would have sent.
  headers.set("host", endpoint.host);

  const requestFn = useTls ? httpsRequest : httpRequest;
  const message = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = requestFn({
      method,
      // `createConnection` returns the socket that was already verified, so no
      // hostname reaches the socket layer and no second lookup can happen. It is
      // only honoured while `agent` stays unset, so do not pass one.
      createConnection: () => socket,
      host: hostname,
      port,
      path: `${endpoint.pathname}${endpoint.search}`,
      headers: Object.fromEntries(headers.entries()),
      setHost: false,
      ...(signal ? { signal } : {}),
    }, resolve);
    req.on("error", reject);
    // Headers deadline. `req.setTimeout` is socket-idle based, which a server
    // that dribbles bytes could reset forever, so hold a hard timer instead.
    const headersTimer = setTimeout(() => {
      // Destroying the request tears the socket down too, so a silent peer costs
      // neither a pending handler nor a leaked descriptor.
      req.destroy(error("Remote MCP endpoint did not respond in time", "remote_http_response_timeout"));
    }, responseTimeoutMs);
    headersTimer.unref?.();
    req.on("response", () => clearTimeout(headersTimer));
    req.on("error", () => clearTimeout(headersTimer));
    if (body !== undefined) req.write(body);
    req.end();
  });

  // Body idle deadline, mirroring undici's `bodyTimeout`: a stalled stream is
  // destroyed so `response.text()` rejects instead of hanging the caller.
  message.setTimeout(responseTimeoutMs, () => {
    message.destroy(error("Remote MCP endpoint stalled mid-response", "remote_http_response_timeout"));
  });
  // A finished response must not leave an armed socket timer behind, or a later
  // reader of the same socket inherits a deadline it never asked for.
  const disarm = () => message.setTimeout(0);
  message.once("end", disarm);
  message.once("close", disarm);

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) responseHeaders.append(key, entry);
    } else if (value !== undefined) {
      responseHeaders.append(key, value);
    }
  }

  const status = message.statusCode ?? 502;
  const nullBody = NULL_BODY_STATUSES.has(status) || method === "HEAD";
  if (nullBody) message.resume();

  return new Response(
    nullBody ? null : (Readable.toWeb(decodedBody(message, responseHeaders)) as unknown as ReadableStream<Uint8Array>),
    { status, statusText: message.statusMessage ?? "", headers: responseHeaders },
  );
}

/**
 * Match `fetch`'s content decoding. `node:http` hands back the raw bytes, so a
 * server that compresses without being asked would otherwise turn into a JSON
 * parse failure that looks like a broken MCP server.
 */
function decodedBody(message: IncomingMessage, headers: Headers): Readable {
  const encoding = (message.headers["content-encoding"] ?? "").trim().toLowerCase();
  const decoder = encoding === "gzip" || encoding === "x-gzip"
    ? createGunzip()
    : encoding === "deflate"
      ? createInflate()
      : encoding === "br"
        ? createBrotliDecompress()
        : null;
  if (!decoder) return message;
  headers.delete("content-encoding");
  headers.delete("content-length");
  message.on("error", (error) => decoder.destroy(error));
  return message.pipe(decoder);
}

function readRequestBody(body: RequestInit["body"]): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError("Guarded remote HTTP requests only support string, URLSearchParams and buffer bodies");
}

function once(
  emitter: Socket,
  event: string,
  input: { signal: AbortSignal | null; timeoutMs: number; what: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(new Error(`Timed out trying to ${input.what} the remote MCP endpoint`));
    }, input.timeoutMs);
    timer.unref?.();

    const onAbort = () => settle(input.signal?.reason ?? new Error("Remote MCP request was aborted"));

    function settle(error?: Error) {
      clearTimeout(timer);
      emitter.off(event, onSuccess);
      emitter.off("error", onError);
      input.signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    function onSuccess() {
      settle();
    }
    function onError(error: Error) {
      settle(error);
    }

    emitter.once(event, onSuccess);
    emitter.once("error", onError);
    input.signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

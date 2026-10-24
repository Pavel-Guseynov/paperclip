import { createServer, type IncomingMessage, type RequestOptions, type Server } from "node:http";
import { createServer as createTlsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { createPluginEventBus } from "../services/plugin-event-bus.js";

const boundary = vi.hoisted(() => ({
  lookup: vi.fn(),
  dialled: [] as Array<RequestOptions & { servername?: string }>,
  ports: new Set<number>(),
}));
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:dns/promises")>(),
  lookup: boundary.lookup,
}));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    request: (options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      boundary.dialled.push(options);
      if (!boundary.ports.has(Number(options.port))) throw new Error("test network has no route to this port");
      return actual.request({ ...options, host: "127.0.0.1", agent: false }, callback);
    },
  };
});
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return {
    ...actual,
    request: (options: RequestOptions & { servername?: string }, callback: (res: IncomingMessage) => void) => {
      boundary.dialled.push(options);
      if (!boundary.ports.has(Number(options.port))) throw new Error("test network has no route to this port");
      // Route only the dial boundary. A real TLS handshake and HTTP exchange
      // still run; a test-only PSK avoids certificates and trust-store changes.
      return actual.request({
        ...options, host: "127.0.0.1", agent: false,
        ciphers: "PSK-AES128-GCM-SHA256", maxVersion: "TLSv1.2",
        checkServerIdentity: () => undefined,
        pskCallback: () => ({ identity: "fixture", psk: Buffer.alloc(16, 1) }),
      }, callback);
    },
  };
});

const HOST = "git.private.test";
const servers: Server[] = [];
const services: ReturnType<typeof buildHostServices>[] = [];

beforeEach(() => {
  boundary.lookup.mockReset();
  boundary.dialled.length = 0;
  boundary.ports.clear();
  vi.stubEnv("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS", undefined);
});
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  vi.unstubAllEnvs();
});

function hostServices(setting?: string) {
  vi.stubEnv("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS", setting);
  const config = loadConfig();
  const service = buildHostServices(
    {} as never, "plugin-record-id", "fetch-test",
    createPluginEventBus(),
    undefined, { pluginFetchPrivateHosts: config.pluginFetchPrivateHosts },
  );
  services.push(service);
  return service;
}

async function upstream(useTls: boolean) {
  const requests: Array<{ host?: string; url?: string; sni?: string }> = [];
  const handler = (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    requests.push({
      host: req.headers.host, url: req.url,
      sni: (req.socket as TLSSocket & { servername?: string }).servername,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  };
  const server = useTls
    ? createTlsServer({
      ciphers: "PSK-AES128-GCM-SHA256", maxVersion: "TLSv1.2",
      pskCallback: (_socket, identity) => identity === "fixture" ? Buffer.alloc(16, 1) : null,
    }, handler)
    : createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  boundary.ports.add(port);
  return { port, requests };
}

describe("plugin fetch private host configuration", () => {
  it.each([undefined, ""])("defaults to an empty list for %s", (value) => {
    vi.stubEnv("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS", value);
    expect(loadConfig().pluginFetchPrivateHosts).toEqual([]);
  });

  it("loads comma-separated exact hostnames", () => {
    vi.stubEnv("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS", "git.private.test,build.private.test");
    expect(loadConfig().pluginFetchPrivateHosts).toEqual(["git.private.test", "build.private.test"]);
  });

  it.each([
    "*.private.test", "10.1.2.3", "::1", "[::1]", "2130706433", "0x7f000001",
    "4294967296", "999.999.999.999",
    "https://git.private.test", "https:", "git.private.test:443",
    "git.private.test,", ",git.private.test", "git.private.test,,build.private.test",
    " ", " git.private.test", "git.private.test ", "Git.private.test",
    "-git.test", "git-.test", "git..test", "git.test/", "git.test.", "10.1.2.0/24",
    "a".repeat(64) + ".test", ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(63)].join("."),
  ])("rejects malformed deployment setting %s", (value) => {
    vi.stubEnv("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS", value);
    expect(() => loadConfig()).toThrow("PAPERCLIP_PLUGIN_FETCH_PRIVATE_HOSTS must contain comma-separated exact lowercase hostnames");
  });
});

describe("plugin fetch private host routing", () => {
  it.each([false, true])("pins an allowed private host and preserves Host and SNI (TLS=%s)", async (useTls) => {
    const server = await upstream(useTls);
    const service = hostServices(HOST);
    boundary.lookup.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const result = await service.http.fetch({
      url: `${useTls ? "https" : "http"}://${HOST}:${server.port}/status?ref=head`,
      init: { headers: { Host: "attacker.test" } },
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(boundary.lookup.mock.calls).toEqual([[HOST, { all: true }]]);
    expect(boundary.dialled).toHaveLength(1);
    expect(boundary.dialled[0]).toMatchObject({
      host: "10.1.2.3", port: server.port,
      headers: { host: `${HOST}:${server.port}` },
      servername: useTls ? HOST : undefined,
    });
    expect(server.requests).toEqual([{
      host: `${HOST}:${server.port}`, url: "/status?ref=head",
      sni: useTls ? HOST : undefined,
    }]);
  });

  it.each([undefined, "other.private.test", "private.test", "sub.git.private.test"])(
    "refuses an unlisted private host with setting %s before dialing", async (setting) => {
      const service = hostServices(setting);
      boundary.lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
      await expect(service.http.fetch({ url: `http://${HOST}/` })).rejects.toThrow(
        `All resolved IPs for ${HOST} are in private/reserved ranges`,
      );
      expect(boundary.dialled).toEqual([]);
    },
  );

  it.each([
    "127.0.0.1", "::1", "169.254.169.254", "fe80::1",
    "fe90::1", "fea0::1", "febf::1", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.1.2",
    "0.0.0.0", "::",
  ])("refuses allowed hosts resolving to %s before dialing", async (address) => {
    const service = hostServices(HOST);
    boundary.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(service.http.fetch({ url: `http://${HOST}/` })).rejects.toThrow(
      `All resolved IPs for ${HOST} are in private/reserved ranges`,
    );
    expect(boundary.dialled).toEqual([]);
  });

  it.each(["10.1.2.3", "172.16.1.2", "172.31.255.254", "192.168.88.59", "fd12::1", "fc12::1", "::ffff:10.1.2.3"])(
    "permits the allowed private address %s", async (address) => {
      const server = await upstream(false);
      const service = hostServices(HOST);
      boundary.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
      expect((await service.http.fetch({ url: `http://${HOST}:${server.port}/` })).status).toBe(200);
      expect(boundary.dialled[0]).toMatchObject({ host: address, port: server.port });
    },
  );

  it("retains public address selection when a mixed answer includes forbidden addresses", async () => {
    const server = await upstream(false);
    const service = hostServices();
    boundary.lookup.mockResolvedValue([
      { address: "10.1.2.3", family: 4 }, { address: "93.184.216.34", family: 4 },
    ]);
    expect((await service.http.fetch({ url: `http://${HOST}:${server.port}/` })).status).toBe(200);
    expect(boundary.dialled[0]).toMatchObject({ host: "93.184.216.34", port: server.port });
  });

  it("does not follow redirects to a forbidden endpoint", async () => {
    const server = await upstream(false);
    const listener = servers[0]!;
    listener.removeAllListeners("request");
    listener.on("request", (_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1/internal" });
      res.end();
    });
    const service = hostServices(HOST);
    boundary.lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    const response = await service.http.fetch({ url: `http://${HOST}:${server.port}/` });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://127.0.0.1/internal");
    expect(boundary.dialled).toHaveLength(1);
  });
});

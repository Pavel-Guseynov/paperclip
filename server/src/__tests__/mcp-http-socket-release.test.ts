import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discardResponse, initializeMcpHttpSession } from "../services/mcp-http.js";
import { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";

// A body larger than the transport's read buffer stops the socket from being
// read, so the connection is released only when the body is read or cancelled.
const LARGE_BODY = "x".repeat(3_000_000);
// Far longer than the test timeout: only an explicit release can close the socket.
const IDLE_DEADLINE_MS = 10 * 60_000;

describe("releasing connections of MCP responses that are not read", () => {
  let server: http.Server;
  let port: number;
  let sockets: net.Socket[];

  beforeEach(async () => {
    sockets = [];
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: string; id?: string };
        if (message.method === "initialize") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } }));
        } else {
          res.writeHead(202, { "content-type": "text/plain" });
          res.end(LARGE_BODY);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const send = (init: RequestInit) =>
    guardedRemoteHttpFetch(`http://mcp.test:${port}/mcp`, init, {
      allowPrivateNetwork: true,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      error: (message, code) => Object.assign(new Error(message), { code }),
      responseTimeoutMs: IDLE_DEADLINE_MS,
      socketFactory: (target) => {
        const socket = net.connect({ host: target.address, port: target.port });
        sockets.push(socket);
        return socket;
      },
    });

  const closed = (socket: net.Socket) =>
    socket.destroyed ? Promise.resolve() : new Promise<void>((resolve) => socket.once("close", () => resolve()));

  it("closes the connection of the initialized notification once the session is established", async () => {
    await initializeMcpHttpSession({ send, requestId: "r1" });

    expect(sockets).toHaveLength(2);
    await closed(sockets[1]!);
  });

  it("closes the connection of a response that is discarded", async () => {
    const response = await send({ method: "POST", body: "{}" });

    await discardResponse(response);

    await closed(sockets[0]!);
  });
});

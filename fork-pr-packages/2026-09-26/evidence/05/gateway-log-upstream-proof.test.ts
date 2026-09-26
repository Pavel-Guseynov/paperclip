import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import request from "supertest";
import { expect, it } from "vitest";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";
import { createHttpLogger } from "../middleware/logger.js";

it("redacts a managed gateway token at the real HTTP logging boundary", async () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const app = express();
  app.use(createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)));
  app.post("/api/tool-gateway/tools/call", (_req, res) => res.status(200).json({ ok: true }));
  await request(app)
    .post("/api/tool-gateway/tools/call")
    .set("X-Paperclip-Tool-Gateway-Token", "audit-gateway-header-canary")
    .set("X-Paperclip-Run-Id", "audit-safe-run-id")
    .expect(200);
  const output = chunks.join("");
  expect(output).not.toContain("audit-gateway-header-canary");
  const record = JSON.parse(output.trim());
  expect(record.req.headers["x-paperclip-tool-gateway-token"]).toBe("[Redacted]");
  expect(record.req.headers["x-paperclip-run-id"]).toBe("audit-safe-run-id");
  expect(record.res.statusCode).toBe(200);
});

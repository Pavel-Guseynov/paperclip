import { createServer, request as httpRequest } from "node:http";
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";
import { errorHandler } from "../middleware/error-handler.js";
import { testAdapterEnvironmentSchema } from "@paperclipai/shared";
import {
  createHttpLogger,
  logger,
  wrapLoggerWithRedaction,
} from "../middleware/logger.js";
import { redactSensitive } from "../middleware/redact-sensitive.js";

describe("HTTP logger redaction", () => {
  it.each([
    { method: "POST", path: "/api/routine-triggers/public/private-url-canary/fire" },
    { method: "PUT", path: "/api/routine-triggers/public/private-url-canary/fire" },

    {
      method: "POST",
      path: "http://provider.invalid/api/chat-webhooks/../private-url-canary",
    },
    { method: "GET", path: "/api/chat-webhooks/private-url-canary/slack/" },
    { method: "PUT", path: "/API/CHAT-WEBHOOKS/private-url-canary/SLACK" },
    { method: "PATCH", path: "/api/chat-webhooks//private-url-canary" },
    { method: "DELETE", path: "/api/chat-webhooks/private-url-canary/%XX" },
    {
      method: "POST",
      path: "/api/chat-webhooks/private-url-canary/slack/extra",
    },
    { method: "POST", path: "/api/chat-webhooks?payload=private-url-canary" },
    {
      method: "POST",
      path: "http://provider.invalid/api/chat-webhooks/private-url-canary/slack?token=private-url-canary",
    },
  ])(
    "keeps malformed/rejected webhook $method requests content-free",
    async ({ method, path }) => {
      const privateText = "private-rejected-method-body-canary";
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });
      const app = express();
      app.use(
        createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
      );
      app.use(express.raw({ type: "*/*" }));
      app.use((_req, res) => {
        (res as any).err = new Error(`SDK error echoed ${privateText}`);
        res.setHeader("x-provider-prose", privateText);
        res.status(405).end();
      });
      const server = createServer(app);
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Fixture listener unavailable");
        const body = JSON.stringify({ text: privateText });
        await new Promise<void>((resolve, reject) => {
          const client = httpRequest(
            {
              hostname: "127.0.0.1",
              port: address.port,
              method,
              path,
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
                "x-provider-prose": privateText,
              },
            },
            (res) => {
              expect(res.statusCode).toBe(405);
              res.resume();
              res.on("end", resolve);
            },
          );
          client.on("error", reject);
          client.end(body);
        });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      const output = chunks.join("");
      expect(output).not.toContain(privateText);
      expect(output).not.toContain("private-url-canary");
      expect(output).not.toContain("provider.invalid");
      const log = JSON.parse(output.trim());
      expect(log.req).toMatchObject({
        method,
        url: path.includes("routine-triggers") ? "/api/routine-triggers/public/:publicId/fire" : "/api/chat-webhooks/:publicId/:provider",
      });
      expect(log.reqBody).toBe("[REDACTED]");
      expect(log.err.message).toBe("Chat webhook request failed");
      expect(log.res).toEqual({ statusCode: 405 });
      expect(log.responseTime).toEqual(expect.any(Number));
    },
  );

  it.each(
    ["raw-json", "raw-form", "raw-text", "parsed-json", "parsed-form"].flatMap(
      (bodyKind) =>
        ["warning", "context-error", "bare-sdk-error"].flatMap((failureMode) =>
          [false, true].map((mountedLogger) => ({
            bodyKind,
            failureMode,
            mountedLogger,
          })),
        ),
    ),
  )(
    "omits private webhook input: $bodyKind / $failureMode / mounted=$mountedLogger",
    async ({ bodyKind, failureMode, mountedLogger }) => {
      const canaries = {
        text: "private-chat-text-canary-9024",
        filename: "private-file-name-canary-7731.txt",
        token: "private-webhook-token-canary-2342",
        sdk: "private-sdk-prose-canary-1148",
      };
      const payload = {
        text: canaries.text,
        files: [{ name: canaries.filename }],
        token: canaries.token,
      };
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });
      const testLogger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
      const app = express();
      const routes = express.Router();
      if (mountedLogger) routes.use(createHttpLogger(testLogger));
      else app.use(createHttpLogger(testLogger));
      routes.use(
        bodyKind === "parsed-json"
          ? express.json()
          : bodyKind === "parsed-form"
            ? express.urlencoded({ extended: false })
            : bodyKind === "raw-text"
              ? express.text({ type: "*/*" })
              : express.raw({ type: "*/*" }),
      );
      routes.post("/chat-webhooks/:publicId/:provider", (req, res) => {
        res.setHeader("x-provider-diagnostic", canaries.sdk);
        const sdkError = Object.assign(
          new Error(`${canaries.sdk}: ${canaries.text} ${canaries.token}`),
          {
            name: canaries.filename,
            request: { body: req.body },
            response: { data: canaries.text },
          },
        );
        if (failureMode === "context-error") {
          (res as any).__errorContext = {
            error: {
              message: sdkError.message,
              stack: sdkError.stack,
              name: sdkError.name,
              raw: sdkError,
            },
            reqBody: req.body,
            reqParams: { ...req.params, private: canaries.filename },
            reqQuery: { text: canaries.text },
          };
        }
        if (failureMode !== "warning") (res as any).err = sdkError;
        res.status(failureMode === "warning" ? 401 : 503).end();
      });
      app.use("/api", routes);
      const contentType = bodyKind.includes("form")
        ? "application/x-www-form-urlencoded"
        : bodyKind === "raw-text"
          ? "text/plain"
          : "application/json";
      const wireBody = bodyKind.includes("form")
        ? new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
        : JSON.stringify(payload);
      const response = await request(app)
        .post("/api/chat-webhooks/endpoint-1/slack")
        .set("Content-Type", contentType)
        .send(wireBody);
      expect(response.status).toBe(failureMode === "warning" ? 401 : 503);
      const output = chunks.join("");
      const log = JSON.parse(output.trim());
      // Structural absence catches Buffer's numeric-byte representation too;
      // matching plaintext canaries alone would miss that encoding of the body.
      expect(log.reqBody).toBe("[REDACTED]");
      expect(log.reqParams).toBeUndefined();
      expect(log.req.body).toBeUndefined();
      expect(log.req.params).toBeUndefined();
      expect(log.req.query).toBeUndefined();
      expect(log.req.method).toBe("POST");
      expect(log.res.statusCode).toBe(response.status);
      expect(log.res.headers).toBeUndefined();
      expect(log.responseTime).toEqual(expect.any(Number));
      expect(log.level).toBe(failureMode === "warning" ? 40 : 50);
      for (const canary of Object.values(canaries))
        expect(output).not.toContain(canary);
      if (failureMode !== "warning") {
        expect(log.msg).toMatch(/503 — request failed$/);
        expect(log.err.message).toBe("Chat webhook request failed");
        expect(log.err.request).toBeUndefined();
        expect(log.errorContext).toEqual({ name: "Error" });
      }
    },
  );

  it.each(["slack", "github", "discord", "telegram", "microsoft-teams"])(
    "keeps %s webhook request serialization and error-handler SDK prose content-free",
    async (provider) => {
      const privateText = "private-serialized-webhook-text-canary-8124";
      const privateFile = "private-serialized-webhook-file-canary-2443.png";
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });
      const app = express();
      const routes = express.Router();
      routes.use(express.raw({ type: "*/*" }));
      routes.use(
        createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
      );
      routes.post("/chat-webhooks/:publicId/:provider", (req, _res, next) => {
        req.params.extra = privateFile;
        req.log.warn({ req }, "Webhook fixture rejected");
        const error = Object.assign(new Error(`SDK echoed ${privateText}`), {
          name: privateFile,
        });
        next(error);
      });
      app.use("/api", routes);
      app.use(errorHandler);
      const response = await request(app)
        .post(`/api/chat-webhooks/endpoint-1/${provider}`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ text: privateText, file: privateFile }));
      expect(response.status).toBe(500);
      const output = chunks.join("");
      expect(output).not.toContain(privateText);
      expect(output).not.toContain(privateFile);
      const logs = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.req.method).toBe("POST");
        expect(log.req.params).toBeUndefined();
        expect(log.req.body).toBeUndefined();
      }
      expect(logs[1].res.statusCode).toBe(500);
      expect(logs[1].reqBody).toBe("[REDACTED]");
      expect(logs[1].errorContext).toEqual({ name: "Error" });
      expect(logs[1].err.message).toBe("Chat webhook request failed");
    },
  );

  it("preserves ordinary request diagnostics outside the exact webhook route", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );
    app.post("/api/issues/:id", (req, res) => {
      (res as any).__errorContext = {
        error: { name: "Error", message: "ordinary diagnostic" },
        reqBody: req.body,
        reqParams: req.params,
      };
      res.status(422).end();
    });
    await request(app)
      .post("/api/issues/issue-1")
      .send({ title: "ordinary task", token: "redact-me" });
    const log = JSON.parse(chunks.join("").trim());
    expect(log.reqBody).toEqual({
      title: "ordinary task",
      token: "[REDACTED]",
    });
    expect(log.reqParams).toEqual({ id: "issue-1" });
    expect(log.errorContext).toEqual({
      name: "Error",
      message: "ordinary diagnostic",
    });
  });

  it("defines the HTTP auth and cookie header paths that must be redacted", () => {
    expect(HTTP_LOG_REDACT_PATHS).toContain("req.headers.authorization");
    expect(HTTP_LOG_REDACT_PATHS).toContain("req.headers.cookie");
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["set-cookie"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('res.headers["set-cookie"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["proxy-authorization"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-csrf-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-xsrf-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-api-key"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-telegram-bot-api-secret-token"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-tool-gateway-token"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'res.headers["x-paperclip-tool-gateway-token"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-github-capability"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'res.headers["x-paperclip-github-capability"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-dev-server-status-token"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-cloud-runtime-identity"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-cloud-control"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain(
      'req.headers["x-paperclip-signature"]',
    );
    expect(HTTP_LOG_REDACT_PATHS).toContain("reqBody.credentials");
    expect(HTTP_LOG_REDACT_PATHS).toContain("errorContext.details.credentials");
  });

  it("redacts request and response header secrets from pino-http output", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const httpLogger = pinoHttp({ logger });
    const server = createServer((req, res) => {
      httpLogger(req, res);
      res.setHeader("set-cookie", "sid=response-secret");
      res.end("ok");
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected server to listen on an ephemeral TCP port");
      }

      await new Promise<void>((resolve, reject) => {
        const client = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/api/chat-webhooks/endpoint-1/telegram",
            headers: {
              authorization: "Bearer auth-secret",
              cookie: "sid=request-secret",
              "set-cookie": "proxy-secret",
              "x-telegram-bot-api-secret-token":
                "telegram-webhook-canary-534c28",
            },
          },
          (res) => {
            res.resume();
            res.on("end", resolve);
          },
        );
        client.on("error", reject);
        client.end();
      });

      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    const output = chunks.join("");
    expect(output).not.toMatch(
      /auth-secret|request-secret|proxy-secret|response-secret|telegram-webhook-canary-534c28/,
    );

    const log = JSON.parse(output.trim()) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(log.req.headers.authorization).toBe("[Redacted]");
    expect(log.req.headers.cookie).toBe("[Redacted]");
    expect(log.req.headers["set-cookie"]).toBe("[Redacted]");
    expect(log.req.headers["x-telegram-bot-api-secret-token"]).toBe(
      "[Redacted]",
    );
    expect(log.res.headers["set-cookie"]).toBe("[Redacted]");
  });

  it.each([200, 403, 500])("redacts runtime GitHub capabilities from HTTP %i logs", async (status) => {
    const capability = "runtime-github-capability-canary";
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)));
    app.post("/runtime-tools/github/credentials", (_req, res) => {
      res.status(status).json({ status });
    });

    await request(app)
      .post("/runtime-tools/github/credentials")
      .set("X-Paperclip-Github-Capability", capability)
      .send({})
      .expect(status);

    const output = chunks.join("");
    expect(output).not.toContain(capability);
    const log = JSON.parse(output.trim());
    expect(log.req.headers["x-paperclip-github-capability"]).toBe("[Redacted]");
    expect(log.req.url).toBe("/runtime-tools/github/credentials");
    expect(log.res.statusCode).toBe(status);
  });

  it("drops OAuth callback query data from the message and structured request", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const app = express();
    app.use(createHttpLogger(testLogger));
    app.get("/api/tools/oauth/callback", (_req, res) => {
      res.status(400).json({ error: "callback rejected" });
    });

    const authorizationCode = "oauth-code-canary-61a88f";
    const providerProse = "provider-prose-canary-2087e2";
    const providerUriCanary = "provider-uri-canary-d91ac4";
    const response = await request(app)
      .get("/api/tools/oauth/callback")
      .query({
        code: authorizationCode,
        error_description: providerProse,
        error_uri: `https://provider.example/error?detail=${providerUriCanary}`,
      });

    expect(response.status).toBe(400);
    const output = chunks.join("");
    expect(output).not.toMatch(
      new RegExp(`${authorizationCode}|${providerProse}|${providerUriCanary}`),
    );

    const log = JSON.parse(output.trim()) as {
      msg: string;
      req: { method: string; url: string; query?: unknown };
      reqQuery?: unknown;
    };
    expect(log.msg).toBe("GET /api/tools/oauth/callback 400");
    expect(log.req).toMatchObject({
      method: "GET",
      url: "/api/tools/oauth/callback",
    });
    expect(log.req.query).toBeUndefined();
    expect(log.reqQuery).toBeUndefined();
  });

  it("redacts failed secret payload values from structured request logs", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const app = express();
    app.use(express.json());
    app.use(createHttpLogger(testLogger));
    app.post("/api/companies/:companyId/secrets", (_req, res) => {
      res.status(422).json({ error: "validation failed" });
    });

    const response = await request(app)
      .post("/api/companies/company-1/secrets")
      .send({
        name: "OpenAI",
        value: "value-canary-4c845d",
        metadata: { token: "token-canary-902ffc" },
      });

    expect(response.status).toBe(422);
    const output = chunks.join("");
    expect(output).not.toMatch(/value-canary-4c845d|token-canary-902ffc/);

    const log = JSON.parse(output.trim()) as {
      reqBody: Record<string, unknown>;
    };
    expect(log.reqBody).toEqual({
      name: "OpenAI",
      value: "[REDACTED]",
      metadata: { token: "[REDACTED]" },
    });
  });

  it("redacts every credential from serialized chat setup 422 and 500 logs", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const app = express();
    app.use(express.json());
    app.use(createHttpLogger(testLogger));
    const routes = express.Router();
    routes.post("/chat-endpoints/:endpointId/setup", (req, res, next) => {
      const mode = req.header("x-test-mode");
      if (mode === "generic-500") {
        const error = new Error(
          `synthetic provider failure echoed ${req.body.credentials.botToken}`,
        );
        error.name = `SecretName-${req.body.credentials.signingSecret}`;
        next(error);
        return;
      }
      if (mode === "http-500") {
        next(
          new HttpError(
            500,
            `synthetic HTTP failure echoed ${req.body.credentials.webhookSecret}`,
            { credentials: req.body.credentials },
          ),
        );
        return;
      }
      next(
        new HttpError(
          422,
          `synthetic validation failure echoed ${req.body.credentials.privateKey}`,
          { credentials: req.body.credentials },
        ),
      );
    });
    routes.post(
      "/chat-endpoints/:endpointId/setup-secret",
      (req, _res, next) => {
        next(
          new Error(`synthetic rotation failure echoed ${req.body.bot_token}`),
        );
      },
    );
    app.use("/api", routes);
    app.use(errorHandler);

    const credentials = {
      botToken: "bot-token-canary-bf231a",
      signingSecret: "signing-secret-canary-0f861d",
      webhookSecret: "webhook-secret-canary-54c112",
      privateKey: "private-key-canary-26ec43",
      clientSecret: "client-secret-canary-944088",
      arbitraryFutureCredential: "future-credential-canary-5e6941",
    };
    const outsideEnvelope = {
      bot_token: "snake-bot-canary-512c31",
      signing_secret: "snake-signing-canary-efb11f",
      webhook_secret: "snake-webhook-canary-415b14",
      secret_token: "snake-secret-token-canary-3ba19f",
      app_secret: "snake-app-canary-fd29eb",
      application_secret: "snake-application-canary-42bc91",
    };
    const canaries = [
      ...Object.values(credentials),
      ...Object.values(outsideEnvelope),
    ];

    const validationResponse = await request(app)
      .post("/api/chat-endpoints/endpoint-1/setup")
      .send({ action: "configure", credentials, diagnostic: outsideEnvelope });
    const genericCrashResponse = await request(app)
      .post("/api/chat-endpoints/endpoint-1/setup")
      .set("x-test-mode", "generic-500")
      .send({ action: "configure", credentials, diagnostic: outsideEnvelope });
    const httpCrashResponse = await request(app)
      .post("/api/chat-endpoints/endpoint-1/setup")
      .set("x-test-mode", "http-500")
      .send({ action: "configure", credentials, diagnostic: outsideEnvelope });
    const setupSecretCrashResponse = await request(app)
      .post("/api/chat-endpoints/endpoint-1/setup-secret")
      .send({ bot_token: outsideEnvelope.bot_token });

    expect(validationResponse.status).toBe(422);
    expect(genericCrashResponse.status).toBe(500);
    expect(httpCrashResponse.status).toBe(500);
    expect(setupSecretCrashResponse.status).toBe(500);
    for (const response of [
      validationResponse,
      genericCrashResponse,
      httpCrashResponse,
      setupSecretCrashResponse,
    ]) {
      for (const canary of canaries) {
        expect(JSON.stringify(response.body)).not.toContain(canary);
      }
    }
    expect(validationResponse.body).toMatchObject({
      error: "synthetic validation failure echoed [REDACTED]",
      details: { credentials: "[REDACTED]" },
    });
    expect(httpCrashResponse.body).toEqual({ error: "Internal server error" });
    const output = chunks.join("");
    for (const canary of canaries) {
      expect(output).not.toContain(canary);
    }

    const logs = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)) as Array<{
      msg: string;
      res: { statusCode: number };
      req: { url: string };
      reqBody: Record<string, unknown>;
      errorContext?: Record<string, unknown>;
    }>;
    expect(logs).toHaveLength(4);
    const setupLogs = logs.filter((log) => log.req.url.endsWith("/setup"));
    expect(setupLogs).toHaveLength(3);
    for (const log of setupLogs) {
      expect(log.reqBody).toEqual({
        action: "configure",
        credentials: "[Redacted]",
        diagnostic: Object.fromEntries(
          Object.keys(outsideEnvelope).map((key) => [key, "[REDACTED]"]),
        ),
      });
    }
    const crashLogs = logs.filter((log) => log.res.statusCode === 500);
    expect(crashLogs).toHaveLength(3);
    for (const log of crashLogs) {
      expect(log.msg).toMatch(/ 500 — request failed$/);
      expect(log.errorContext).toEqual({ name: "Error" });
    }
    expect(
      logs.find((log) => log.req.url.endsWith("/setup-secret"))?.reqBody,
    ).toEqual({
      bot_token: "[REDACTED]",
    });
  });

  it.each([400, 500])(
    "redacts the complete probe credential container on HTTP %s",
    async (status) => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          callback();
        },
      });
      const app = express();
      app.use(express.json());
      app.use(
        createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
      );
      app.post("/probe", (req, res) => {
        if (status === 500) {
          (res as any).__errorContext = {
            error: { message: "probe failed" },
            reqBody: req.body,
          };
        }
        res.status(status).json({ error: "probe failed" });
      });
      const keys = Object.keys(
        testAdapterEnvironmentSchema.shape.testCredentials.unwrap().shape,
      );
      const credentials = Object.fromEntries(
        [...keys, "UNKNOWN_PROVIDER_KEY"].map((key) => [key, `canary-${key}`]),
      );
      await request(app)
        .post("/probe")
        .send({
          adapterConfig: { model: "default" },
          testCredentials: credentials,
        });
      const output = chunks.join("");
      expect(output).not.toContain("canary-");
      expect(JSON.parse(output.trim()).reqBody).toEqual({
        adapterConfig: { model: "default" },
        testCredentials: "[REDACTED]",
      });
    },
  );

  it("redacts Paperclip gateway tokens and authorization credentials on successful 200 requests while preserving diagnostics", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const bearerSentinel = "pcgw_sentinel_success_99a8b7c6";
    const headerSentinel = "pcgt_sentinel_success_11223344";
    const runId = "run-success-safe-uuid-1234";
    const clientName = "cursor-client-diagnostic-5678";

    app.post("/api/tool-gateway/tools/call", (_req, res) => {
      res.status(200).json({ status: "ok", result: { data: "success" } });
    });

    const response = await request(app)
      .post("/api/tool-gateway/tools/call")
      .set("Authorization", `Bearer ${bearerSentinel}`)
      .set("x-paperclip-tool-gateway-token", headerSentinel)
      .set("X-Paperclip-Run-Id", runId)
      .set("X-Paperclip-Client-Name", clientName)
      .send({ tool: "calculator:add", parameters: { a: 1, b: 2 } });

    expect(response.status).toBe(200);
    const output = chunks.join("");
    expect(output).not.toContain(bearerSentinel);
    expect(output).not.toContain(headerSentinel);
    expect(output).toContain(runId);
    expect(output).toContain(clientName);

    const log = JSON.parse(output.trim()) as {
      res: { statusCode: number };
      req: { headers: Record<string, string> };
    };
    expect(log.res.statusCode).toBe(200);
    expect(log.req.headers.authorization).toBe("[Redacted]");
    expect(log.req.headers["x-paperclip-tool-gateway-token"]).toBe("[Redacted]");
    expect(log.req.headers["x-paperclip-run-id"]).toBe(runId);
    expect(log.req.headers["x-paperclip-client-name"]).toBe(clientName);
  });

  it("redacts gateway tokens on rejected 401 authentication while preserving reasonCode and diagnostics", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const rejectedSentinel = "pcgt_sentinel_rejected_55443322";
    const runId = "run-rejected-safe-uuid-9988";

    app.post("/api/tool-gateway/tools", (req, _res, next) => {
      const token = req.header("x-paperclip-tool-gateway-token") ?? "";
      next(
        new HttpError(401, `Invalid tool gateway session token: ${token}`, {
          reasonCode: "invalid_token",
        }),
      );
    });
    app.use(errorHandler);

    const response = await request(app)
      .post("/api/tool-gateway/tools")
      .set("x-paperclip-tool-gateway-token", rejectedSentinel)
      .set("X-Paperclip-Run-Id", runId);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Invalid tool gateway session token: [REDACTED]",
      details: {
        reasonCode: "invalid_token",
      },
    });

    const output = chunks.join("");
    expect(output).not.toContain(rejectedSentinel);
    expect(output).toContain(runId);

    const log = JSON.parse(output.trim()) as {
      res: { statusCode: number };
      req: { headers: Record<string, string> };
      msg: string;
    };
    expect(log.res.statusCode).toBe(401);
    expect(log.req.headers["x-paperclip-tool-gateway-token"]).toBe("[Redacted]");
    expect(log.req.headers["x-paperclip-run-id"]).toBe(runId);
    expect(log.msg).not.toContain(rejectedSentinel);
  });

  it("redacts echoed gateway credentials during downstream MCP provider failures", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const downstreamSentinel = "pcgw_sentinel_downstream_aabbccdd";

    app.post("/api/tool-gateway/tools/call", (_req, res) => {
      (res as any).__errorContext = {
        error: {
          message: `Downstream MCP service timed out for token ${downstreamSentinel}`,
          reasonCode: "downstream_timeout",
        },
      };
      res.status(502).json({
        error: "Downstream failure",
        reasonCode: "downstream_timeout",
      });
    });

    const response = await request(app)
      .post("/api/tool-gateway/tools/call")
      .set("Authorization", `Bearer ${downstreamSentinel}`)
      .send({ tool: "weather:forecast", parameters: {} });

    expect(response.status).toBe(502);
    expect(response.body.reasonCode).toBe("downstream_timeout");

    const output = chunks.join("");
    expect(output).not.toContain(downstreamSentinel);

    const log = JSON.parse(output.trim()) as {
      res: { statusCode: number };
      msg: string;
      errorContext?: { message?: string; reasonCode?: string };
    };
    expect(log.res.statusCode).toBe(502);
    expect(log.msg).not.toContain(downstreamSentinel);
    expect(log.errorContext?.message).not.toContain(downstreamSentinel);
    expect(log.errorContext?.message).toContain("[REDACTED]");
  });

  it("redacts gateway tokens from uncaught 500 error messages, stack traces, and HTTP error context", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const crashToken1 = "pcgw_sentinel_crash_1234abcd";
    const crashToken2 = "pcgt_sentinel_crash_5678ef01";

    app.post("/api/tool-gateway/crash", () => {
      throw new Error(
        `Unexpected crash while resolving gateway token ${crashToken1} and session ${crashToken2}`,
      );
    });
    app.use(errorHandler);

    const response = await request(app)
      .post("/api/tool-gateway/crash")
      .send({ data: "crash-test" });

    expect(response.status).toBe(500);
    const output = chunks.join("");
    expect(output).not.toContain(crashToken1);
    expect(output).not.toContain(crashToken2);

    const log = JSON.parse(output.trim()) as {
      res: { statusCode: number };
      msg: string;
      err?: { message?: string; stack?: string };
      errorContext?: { message?: string; stack?: string };
    };
    expect(log.res.statusCode).toBe(500);
    expect(log.msg).not.toContain(crashToken1);
    expect(log.msg).not.toContain(crashToken2);
    expect(log.msg).toContain("[REDACTED]");
    if (log.err) {
      expect(log.err.message).not.toContain(crashToken1);
      expect(log.err.message).not.toContain(crashToken2);
      expect(log.err.stack).not.toContain(crashToken1);
      expect(log.err.stack).not.toContain(crashToken2);
    }
    if (log.errorContext) {
      expect(log.errorContext.message).not.toContain(crashToken1);
      expect(log.errorContext.message).not.toContain(crashToken2);
    }
  });

  it("redacts mixed-case gateway and authorization headers regardless of casing", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const mixedHeaderSentinel = "pcgt_sentinel_mixed_header_9988";
    const mixedBearerSentinel = "pcgw_sentinel_mixed_bearer_7766";
    const mixedCapSentinel = "cap_sentinel_mixed_5544";
    const runId = "run-mixed-safe-uuid-1122";

    app.get("/api/tool-gateway/mixed", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const response = await request(app)
      .get("/api/tool-gateway/mixed")
      .set("X-Paperclip-Tool-Gateway-Token", mixedHeaderSentinel)
      .set("Authorization", `Bearer ${mixedBearerSentinel}`)
      .set("X-Paperclip-Github-Capability", mixedCapSentinel)
      .set("X-Paperclip-Run-Id", runId);

    expect(response.status).toBe(200);
    const output = chunks.join("");
    expect(output).not.toContain(mixedHeaderSentinel);
    expect(output).not.toContain(mixedBearerSentinel);
    expect(output).not.toContain(mixedCapSentinel);
    expect(output).toContain(runId);

    const log = JSON.parse(output.trim()) as {
      req: { headers: Record<string, string> };
    };
    expect(log.req.headers["x-paperclip-tool-gateway-token"]).toBe("[Redacted]");
    expect(log.req.headers.authorization).toBe("[Redacted]");
    expect(log.req.headers["x-paperclip-github-capability"]).toBe("[Redacted]");
    expect(log.req.headers["x-paperclip-run-id"]).toBe(runId);
  });

  it("recursively redacts gateway tokens in nested object properties and custom props", () => {
    const nestedToken1 = "pcgw_sentinel_nested_aaa1";
    const nestedToken2 = "pcgt_sentinel_nested_bbb2";
    const nestedToken3 = "token_sentinel_deep_ccc3";

    const payload = {
      session: {
        gatewayToken: nestedToken1,
        metadata: {
          toolGatewayToken: nestedToken2,
          details: {
            token: nestedToken3,
            safeMetadata: "normal-diagnostic-info",
          },
        },
      },
    };

    const redacted = redactSensitive(payload) as typeof payload;
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(nestedToken1);
    expect(serialized).not.toContain(nestedToken2);
    expect(serialized).not.toContain(nestedToken3);
    expect(redacted.session.gatewayToken).toBe("[REDACTED]");
    expect(redacted.session.metadata.toolGatewayToken).toBe("[REDACTED]");
    expect(redacted.session.metadata.details.token).toBe("[REDACTED]");
    expect(redacted.session.metadata.details.safeMetadata).toBe(
      "normal-diagnostic-info",
    );
  });

  it("redacts gateway tokens across child logger bindings, info calls, and error methods", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const testLogger = wrapLoggerWithRedaction(
      pino(
        {
          redact: [...HTTP_LOG_REDACT_PATHS],
          serializers: {
            headers: (h: any) =>
              h && typeof h === "object" ? redactSensitive(h) : h,
          },
          hooks: {
            logMethod(inputArgs: unknown[], method: any) {
              const sanitizedArgs = inputArgs.map((arg) => {
                if (arg instanceof Error) {
                  const copy = new Error(arg.message);
                  copy.name = arg.name;
                  copy.stack = arg.stack;
                  return redactSensitive(copy);
                }
                if (typeof arg === "string") {
                  return redactSensitive(arg);
                }
                if (arg && typeof arg === "object") {
                  return redactSensitive(arg);
                }
                return arg;
              });
              return method.apply(this, sanitizedArgs);
            },
          },
        },
        stream,
      ),
    );

    const childBinding1 = "pcgw_sentinel_child_binding_1";
    const childBinding2 = "pcgt_sentinel_child_binding_2";
    const childLogToken = "pcgw_sentinel_child_info_3";
    const childErrorToken = "pcgw_sentinel_child_err_4";

    const child = testLogger.child({
      gatewayToken: childBinding1,
      "X-Paperclip-Tool-Gateway-Token": childBinding2,
      service: "tool-gateway",
    });

    child.info({
      token: childLogToken,
      msg: `calling gateway with Bearer ${childLogToken}`,
    });
    child.error(
      new Error(`Downstream connection failed for ${childErrorToken}`),
    );

    const output = chunks.join("");
    expect(output).not.toContain(childBinding1);
    expect(output).not.toContain(childBinding2);
    expect(output).not.toContain(childLogToken);
    expect(output).not.toContain(childErrorToken);
    expect(output).toContain("tool-gateway");
  });

  it("audits token-bearing URLs and strips query secrets from HTTP message and structured records", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = express();
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );

    const queryToken1 = "pcgt_sentinel_query_1122";
    const queryToken2 = "pcgw_sentinel_query_3344";

    app.get("/api/tool-gateway/tools", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const response = await request(app).get(
      `/api/tool-gateway/tools?sessionToken=${queryToken1}&gatewayToken=${queryToken2}#secret-fragment`,
    );

    expect(response.status).toBe(200);
    const output = chunks.join("");
    expect(output).not.toContain(queryToken1);
    expect(output).not.toContain(queryToken2);
    expect(output).not.toContain("secret-fragment");

    const log = JSON.parse(output.trim()) as {
      msg: string;
      req: { method: string; url: string; query?: unknown };
      reqQuery?: unknown;
    };
    expect(log.msg).toBe("GET /api/tool-gateway/tools 200");
    expect(log.req.url).toBe("/api/tool-gateway/tools");
    expect(log.req.query).toBeUndefined();
    expect(log.reqQuery).toBeUndefined();
  });
});


import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConsoleLogger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { AppModule } from "./app.module.js";
import { attachAgentHub } from "./agent-hub.js";
import { PrismaService } from "./prisma.service.js";
import { ProblemDetailsFilter } from "./problem.filter.js";
import { serveWebConsole } from "./web-console.js";
import { BackupRuntime } from "./backup-runtime.js";

function validateEnvironment(): void {
  const encoded = process.env.NETSENTINEL_MASTER_KEY;
  if (!encoded || Buffer.from(encoded, "base64").length !== 32) throw new Error("NETSENTINEL_MASTER_KEY must be a base64-encoded 32-byte key");
}

function trustProxySetting(): false | number | string[] {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") {
    throw new Error("TRUST_PROXY=true is unsafe; configure a hop count or trusted proxy CIDRs");
  }
  if (/^\d+$/u.test(value)) return Number(value);
  const trusted = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!trusted.length) throw new Error("TRUST_PROXY must be false, a hop count, or trusted proxy CIDRs");
  return trusted;
}

const loginAccountKey = (request: { body?: unknown }) => {
  const body = request.body;
  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
  return `account:${email || "unknown"}`;
};

async function bootstrap(): Promise<void> {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, { cors: false, logger: new ConsoleLogger({ json: true }) });
  app.getHttpAdapter().getInstance().set("trust proxy", trustProxySetting());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(
    "/api/v1/auth/login",
    rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false }),
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: loginAccountKey,
    }),
  );
  app.use("/api/v1/public/status", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use(/^\/api\/v1\/admin\/backups\/[^/]+\/(?:download|restore)$/u,
    rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:8080", credentials: true, allowedHeaders: ["content-type", "authorization", "x-csrf-token", "if-match"] });
  app.setGlobalPrefix("api/v1");
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("NetSentinel API").setVersion("1.0").addCookieAuth("netsentinel_session").addBearerAuth().build());
  SwaggerModule.setup("api/docs", app, document);
  const closeAgentHub = attachAgentHub(app.getHttpServer(), app.get(PrismaService), app.get(BackupRuntime));
  serveWebConsole(app.getHttpAdapter().getInstance());
  app.enableShutdownHooks();
  process.once("SIGTERM", () => void closeAgentHub());
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}

void import("./combined/server.js").then(({ startCombinedApplication }) => startCombinedApplication()).catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : "STARTUP_FAILED";
  console.error(`NetSentinel could not start (${code}). Check persistent storage, database availability and legacy worker migration.`);
  process.exitCode = 1;
});

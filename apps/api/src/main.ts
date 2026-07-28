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

function validateEnvironment(): void {
  const encoded = process.env.NETSENTINEL_MASTER_KEY;
  if (!encoded || Buffer.from(encoded, "base64").length !== 32) throw new Error("NETSENTINEL_MASTER_KEY must be a base64-encoded 32-byte key");
}

async function bootstrap(): Promise<void> {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, { cors: false, logger: new ConsoleLogger({ json: true }) });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use("/api/v1/auth/login", rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api/v1/public/status", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true, allowedHeaders: ["content-type", "authorization", "x-csrf-token", "if-match"] });
  app.setGlobalPrefix("api/v1");
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("NetSentinel API").setVersion("1.0").addCookieAuth("netsentinel_session").addBearerAuth().build());
  SwaggerModule.setup("api/docs", app, document);
  const closeAgentHub = attachAgentHub(app.getHttpServer(), app.get(PrismaService));
  app.enableShutdownHooks();
  process.once("SIGTERM", () => void closeAgentHub());
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}

void bootstrap();

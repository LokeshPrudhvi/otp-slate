import "reflect-metadata";
import {
  Catch,
  HttpException,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { ZodError } from "zod";
import { RegistrationController } from "./registration-controller.js";
import { ApiController } from "./controller.js";
import { AccessController } from "./access-controller.js";
import { AnnouncementController } from "./announcement-controller.js";
import { BranchController } from "./branch-controller.js";
import { SlateService } from "./service.js";
import { portalProxyIngress } from "./portal-proxy.js";

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      return res
        .status(error.getStatus())
        .json(typeof body === "string" ? { message: body } : body);
    }
    if (error instanceof ZodError)
      return res.status(400).json({
        message: error.issues[0]?.message || "Check the form fields.",
      });
    const record = error as {
      code?: string;
      cause?: { code?: string };
      statusCode?: number;
    };
    if (record?.code === "23505" || record?.cause?.code === "23505")
      return res
        .status(409)
        .json({ message: "A record with these details already exists." });
    if (
      record?.statusCode &&
      record.statusCode >= 400 &&
      record.statusCode < 500
    )
      return res.status(record.statusCode).json({
        message: "The request could not be completed. Check the details.",
      });
    console.error(
      "API request failed.",
      error instanceof Error ? error.constructor.name : "UnknownError",
    );
    return res
      .status(500)
      .json({ message: "The request could not be completed. Please retry." });
  }
}
export async function createApplication(service: SlateService) {
  @Module({
    controllers: [
      ApiController,
      RegistrationController,
      AccessController,
      AnnouncementController,
      BranchController,
    ],
    providers: [{ provide: SlateService, useValue: service }],
  })
  class ApplicationModule {}
  const app = await NestFactory.create(ApplicationModule, {
    bodyParser: false,
    logger: false,
  });
  app.use(helmet());
  app.use("/api", (_req: Request, res: Response, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", portalProxyIngress(service.config.portalProxySecret));
  const allowedAuth = new Set([
    "/sign-in/email",
    "/sign-out",
    "/get-session",
    "/request-password-reset",
    "/reset-password",
    "/token",
    "/jwks",
    "/two-factor/enable",
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
  ]);
  app.use(
    "/api/auth",
    async (req: Request, res: Response, next: () => void) => {
      const resetLink =
        req.method === "GET" &&
        /^\/reset-password\/[A-Za-z0-9_-]{16,512}$/.test(req.path);
      if (!allowedAuth.has(req.path) && !resetLink)
        return res
          .status(404)
          .json({ message: "This authentication operation is not available." });
      if (["/token", "/get-session", "/two-factor/enable"].includes(req.path)) {
        try {
          await service.actor(req, undefined, req.path !== "/token");
        } catch {
          return res.status(403).json({
            message: "Sign in and complete account setup before continuing.",
          });
        }
      }
      next();
    },
    toNodeHandler(service.auth),
  );
  app.use(
    "/api/v1/platform/registrations/import",
    express.json({ limit: "2mb" }),
  );
  app.use(
    "/api/v1/platform/courses/:id/publish",
    express.json({ limit: "2mb" }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use("/api/v1", (req: Request, res: Response, next: () => void) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.headers.authorization || req.headers.cookie) &&
      !service.config.origins.includes(req.headers.origin || "")
    )
      return res
        .status(403)
        .json({ message: "The request origin is not allowed." });
    next();
  });
  app
    .getHttpAdapter()
    .get("/api/health", (_req: Request, res: Response) =>
      res.json({ status: "ok", service: "otp-slate-api" }),
    );
  app.useGlobalFilters(new Errors());
  await app.init();
  return app;
}

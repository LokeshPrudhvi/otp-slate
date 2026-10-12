import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { SlateService } from "./service.js";
import { requestClientIp } from "./portal-proxy.js";
import {
  RegistrationService,
  registrationInput,
  studentProfileInput,
} from "./registration.js";

@Controller("api/v1")
export class RegistrationController {
  private readonly registration: RegistrationService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.registration = new RegistrationService(service);
  }
  @Get("registration/organizations") organizations() {
    return this.registration.organizations();
  }
  @Get("registration/organizations/:organizationId/branches") branches(
    @Param("organizationId") organizationId: string,
  ) {
    return this.registration.branches(z.uuid().parse(organizationId));
  }
  @Post("registration/requests") submit(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.registration.submit(
      registrationInput.parse(body),
      requestClientIp(req),
    );
  }
  @Get("platform/registrations") async list(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const input = z
      .object({
        organizationId: z.uuid().optional(),
        status: z
          .enum(["pending", "approved", "rejected", "all"])
          .default("pending"),
      })
      .strict()
      .parse(query);
    return this.registration.list(actor, input.organizationId, input.status);
  }
  @Post("platform/students") async createStudent(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    return this.registration.createStudent(
      actor,
      registrationInput.parse(body),
    );
  }
  @Post("platform/students/import") async createStudents(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const input = z
      .object({
        organizationId: z.uuid(),
        rows: z.array(z.unknown()).min(1).max(25),
      })
      .strict()
      .parse(body);
    return this.registration.createStudents(
      actor,
      input.organizationId,
      input.rows,
    );
  }
  @Patch("platform/organizations/:organizationId/students/:memberId")
  async updateStudent(
    @Req() req: Request,
    @Param("organizationId") organizationId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    return this.registration.updateStudent(
      actor,
      z.uuid().parse(organizationId),
      z.uuid().parse(memberId),
      studentProfileInput.parse(body),
    );
  }
  @Post("platform/registrations/import") async import(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const input = z
      .object({
        organizationId: z.uuid(),
        rows: z.array(z.unknown()).min(1).max(500),
      })
      .strict()
      .parse(body);
    return this.registration.import(actor, input.organizationId, input.rows);
  }
  @Post("platform/registrations/approve") async approve(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const input = z
      .object({
        ids: z
          .array(z.uuid())
          .min(1)
          .max(25)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Choose each request once.",
          ),
      })
      .strict()
      .parse(body);
    return this.registration.approve(actor, input.ids);
  }
  @Post("platform/registrations/:id/reject") async reject(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const input = z
      .object({ reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(body);
    return this.registration.reject(actor, z.uuid().parse(id), input.reason);
  }
  @Post("platform/registrations/:id/retry-email") async retryEmail(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    z.object({})
      .strict()
      .parse(body || {});
    return this.registration.retryEmail(actor, z.uuid().parse(id));
  }
}

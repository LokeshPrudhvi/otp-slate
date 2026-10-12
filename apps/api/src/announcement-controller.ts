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
import {
  AnnouncementService,
  announcementListInput,
  publishAnnouncementInput,
} from "./announcements.js";

@Controller("api/v1/platform/announcements")
export class AnnouncementController {
  private readonly announcements: AnnouncementService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.announcements = new AnnouncementService(service);
  }
  @Get("audience") async audience(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const { organizationId } = z
      .object({ organizationId: z.string().uuid() })
      .strict()
      .parse(query);
    return this.announcements.audience(actor, organizationId);
  }
  @Get() async list(@Req() req: Request, @Query() query: unknown) {
    const actor = await this.service.actor(req, "platform_admin");
    return this.announcements.list(actor, announcementListInput.parse(query));
  }
  @Post() async publish(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.service.actor(req, "platform_admin");
    return this.announcements.publish(
      actor,
      publishAnnouncementInput.parse(body),
    );
  }
  @Patch(":id") async update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, "platform_admin");
    const { status } = z
      .object({ status: z.enum(["published", "archived"]) })
      .strict()
      .parse(body);
    return this.announcements.update(
      actor,
      z.string().uuid().parse(id),
      status,
    );
  }
}

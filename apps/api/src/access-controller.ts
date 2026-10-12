import { Body, Controller, Get, Inject, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { SlateService } from "./service.js";
import { AccessService, updateAccessInput } from "./access.js";
@Controller("api/v1/platform/organizations")
export class AccessController {
  private readonly access: AccessService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.access = new AccessService(service);
  }
  @Get(":id/access") async workspace(
    @Req() request: Request,
    @Param("id") id: string,
  ) {
    return this.access.workspace(
      await this.service.actor(request, "platform_admin"),
      z.string().uuid().parse(id),
    );
  }
  @Put(":id/access") async update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.access.update(
      await this.service.actor(request, "platform_admin"),
      z.string().uuid().parse(id),
      updateAccessInput.parse(body),
    );
  }
}

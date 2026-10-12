import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import {
  BranchService,
  createBranchInput,
  updateBranchInput,
} from "./branches.js";
import { SlateService } from "./service.js";

@Controller("api/v1/platform/organizations")
export class BranchController {
  private readonly branches: BranchService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.branches = new BranchService(service);
  }
  @Get(":organizationId/branches") async list(
    @Req() req: Request,
    @Param("organizationId") organizationId: string,
  ) {
    return this.branches.list(
      await this.service.actor(req, "platform_admin"),
      z.uuid().parse(organizationId),
    );
  }
  @Post(":organizationId/branches") async create(
    @Req() req: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
  ) {
    return this.branches.create(
      await this.service.actor(req, "platform_admin"),
      z.uuid().parse(organizationId),
      createBranchInput.parse(body),
    );
  }
  @Patch(":organizationId/branches/:code") async update(
    @Req() req: Request,
    @Param("organizationId") organizationId: string,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    return this.branches.update(
      await this.service.actor(req, "platform_admin"),
      z.uuid().parse(organizationId),
      code,
      updateBranchInput.parse(body),
    );
  }
}

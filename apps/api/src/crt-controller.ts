import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { SlateService } from "./service.js";
import {
  CrtService,
  crtTopicInput,
  crtUpdateInput,
  crtRevisionInput,
  crtAssignmentsInput,
  crtBankInput,
  crtBankUpdateInput,
  crtSubmitInput,
  crtPracticeInput,
  crtPracticeSubmitInput,
} from "./crt.js";
const uuid = z.uuid();
@Controller("api/v1")
export class CrtController {
  private readonly crt: CrtService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.crt = new CrtService(service);
  }
  @Get("platform/crt/topics") async list(@Req() req: Request) {
    return this.crt.list(await this.service.actor(req, "platform_admin"));
  }
  @Post("platform/crt/topics") async create(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.crt.create(
      await this.service.actor(req, "platform_admin"),
      crtTopicInput.parse(body),
    );
  }
  @Get("platform/crt/topics/:id") async detail(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.crt.detail(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
    );
  }
  @Patch("platform/crt/topics/:id") async update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.update(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      crtUpdateInput.parse(body),
    );
  }
  @Post("platform/crt/topics/:id/publish") async publish(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.publish(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      crtRevisionInput.parse(body).revision,
    );
  }
  @Get("platform/crt/audience") async audience(
    @Req() req: Request,
    @Query("organizationId") org: string,
  ) {
    return this.crt.audience(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(org),
    );
  }
  @Get("platform/crt/assignments") async assignments(
    @Req() req: Request,
    @Query("organizationId") org: string,
    @Query("branchId") branch: string,
  ) {
    return this.crt.assignments(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(org),
      uuid.parse(branch),
    );
  }
  @Put("platform/crt/assignments") async assign(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.crt.assign(
      await this.service.actor(req, "platform_admin"),
      crtAssignmentsInput.parse(body),
    );
  }
  @Get("platform/crt/topics/:id/questions") async bank(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.crt.bank(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
    );
  }
  @Post("platform/crt/topics/:id/questions") async createBank(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.createBank(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      crtBankInput.parse(body),
    );
  }
  @Patch("platform/crt/questions/:id") async updateBank(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.updateBank(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      crtBankUpdateInput.parse(body),
    );
  }
  @Get("student/crt/topics") async studentList(@Req() req: Request) {
    return this.crt.studentList(await this.service.actor(req, "student"));
  }
  @Get("student/crt/topics/:id") async studentDetail(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.crt.studentDetail(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Get("student/crt/topics/:id/pdf") async pdf(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.crt.pdf(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Get("student/crt/topics/:id/images/:uploadId") async image(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("uploadId") uploadId: string,
  ) {
    return this.crt.topicImage(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      uuid.parse(uploadId),
    );
  }
  @Post("student/crt/topics/:id/submit") async submit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.submit(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      crtSubmitInput.parse(body),
    );
  }
  @Post("student/crt/practice") async practice(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.crt.practice(
      await this.service.actor(req, "student"),
      crtPracticeInput.parse(body),
    );
  }
  @Get("student/crt/practice/:id") async session(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.crt.practiceSession(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Post("student/crt/practice/:id/submit") async practiceSubmit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.crt.submitPractice(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      crtPracticeSubmitInput.parse(body),
    );
  }
  @Get("student/crt/practice/:id/images/:uploadId") async practiceImage(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("uploadId") uploadId: string,
  ) {
    return this.crt.practiceImage(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      uuid.parse(uploadId),
    );
  }
}

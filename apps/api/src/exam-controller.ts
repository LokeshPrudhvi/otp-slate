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
  createExamInput,
  ExamService,
  examAnswersInput,
  examEventsInput,
  examRevisionInput,
  examRunInput,
  updateExamInput,
  manualExamGradeInput,
} from "./exams.js";
const uuid = z.uuid();
@Controller("api/v1")
export class ExamController {
  private readonly exams: ExamService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.exams = new ExamService(service);
  }
  @Get("platform/exams/capabilities") async capabilities(@Req() req: Request) {
    return this.exams.capabilities(
      await this.service.actor(req, "platform_admin"),
    );
  }
  @Get("platform/exams/audience") async audience(
    @Req() req: Request,
    @Query("organizationId") org: string,
  ) {
    return this.exams.audience(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(org),
    );
  }
  @Get("platform/exams") async list(
    @Req() req: Request,
    @Query("organizationId") org?: string,
  ) {
    return this.exams.list(
      await this.service.actor(req, "platform_admin"),
      org ? uuid.parse(org) : undefined,
    );
  }
  @Post("platform/exams") async create(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.exams.create(
      await this.service.actor(req, "platform_admin"),
      createExamInput.parse(body),
    );
  }
  @Get("platform/exams/:id") async detail(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.exams.detail(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
    );
  }
  @Patch("platform/exams/:id") async update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.update(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      updateExamInput.parse(body),
    );
  }
  @Post("platform/exams/:id/publish") async publish(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.publish(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      examRevisionInput.parse(body).revision,
    );
  }
  @Post("platform/exams/:id/cancel") async cancel(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.cancel(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      examRevisionInput.parse(body).revision,
    );
  }
  @Post("platform/exams/:id/release-results") async release(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.release(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      examRevisionInput.parse(body).revision,
    );
  }
  @Post("platform/exams/:id/regrade") async regrade(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.regrade(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      examRevisionInput.parse(body).revision,
    );
  }
  @Get("platform/exams/:id/results") async results(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.exams.results(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
    );
  }
  @Get("platform/exams/:id/attempts/:attemptId") async adminAttempt(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("attemptId") attemptId: string,
  ) {
    return this.exams.adminAttempt(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      uuid.parse(attemptId),
    );
  }
  @Post("platform/exams/:id/attempts/:attemptId/grade") async grade(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("attemptId") attemptId: string,
    @Body() body: unknown,
  ) {
    return this.exams.manualGrade(
      await this.service.actor(req, "platform_admin"),
      uuid.parse(id),
      uuid.parse(attemptId),
      manualExamGradeInput.parse(body),
    );
  }
  @Get("student/exams") async studentList(@Req() req: Request) {
    return this.exams.studentList(await this.service.actor(req, "student"));
  }
  @Get("student/exams/:id") async studentExam(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.exams.studentExam(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Post("student/exams/:id/attempt") async start(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    z.object({}).strict().parse(body);
    return this.exams.start(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Get("student/exam-attempts/:id") async attempt(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.exams.attempt(
      await this.service.actor(req, "student"),
      uuid.parse(id),
    );
  }
  @Put("student/exam-attempts/:id/answers") async save(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.save(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      examAnswersInput.parse(body),
    );
  }
  @Post("student/exam-attempts/:id/submit") async submit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.save(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      examAnswersInput.parse(body),
      true,
    );
  }
  @Post("student/exam-attempts/:id/events") async events(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.events(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      examEventsInput.parse(body),
    );
  }
  @Post("student/exam-attempts/:id/run") async run(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.exams.run(
      await this.service.actor(req, "student"),
      uuid.parse(id),
      examRunInput.parse(body),
    );
  }
}

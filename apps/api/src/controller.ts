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
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { SlateService } from "./service.js";
import { MailboxService } from "./mailbox.js";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const portalRoles = {
  student: "student",
  platform: "platform_admin",
  organization: "organization_viewer",
} as const;
const courseInput = z
  .object({
    title: text(150),
    description: text(2000),
    track: z.enum([
      "foundation",
      "hiring",
      "crt",
      "dsa",
      "fullstack",
      "competitive",
    ]),
  })
  .strict();
const lesson = z
  .object({ id: id.optional(), title: text(150), body: text(20_000) })
  .strict();
const resumeInput = z
  .object({
    name: z.string().max(150),
    title: z.string().max(150),
    email: z.string().max(200),
    phone: z.string().max(30),
    location: z.string().max(150).default(""),
    links: z.string().max(500).default(""),
    summary: z.string().max(2000),
    education: z.string().max(4000),
    experience: z.string().max(6000),
    skills: z.string().max(2000),
    projects: z.string().max(6000),
    certifications: z.string().max(4000).default(""),
    template: z.enum(["classic", "compact", "modern", "serif"]),
  })
  .strict();

@Controller("api/v1")
export class ApiController {
  readonly mailbox: MailboxService;
  constructor(@Inject(SlateService) private readonly service: SlateService) {
    this.mailbox = new MailboxService(service.db);
  }
  @Get("mailbox/contacts") async contacts(@Req() req: Request) {
    return this.mailbox.contacts(await this.service.actor(req));
  }
  @Get("mailbox") async mailboxList(
    @Req() req: Request,
    @Query() query: unknown,
  ) {
    const input = z
      .object({
        folder: z
          .enum(["inbox", "unread", "starred", "sent", "archived"])
          .default("inbox"),
        search: z.string().trim().max(150).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .strict()
      .parse(query);
    return this.mailbox.list(await this.service.actor(req), input);
  }
  @Get("mailbox/:id") async mailboxDetail(
    @Req() req: Request,
    @Param("id") message: string,
  ) {
    return this.mailbox.detail(
      await this.service.actor(req),
      id.parse(message),
    );
  }
  @Post("mailbox") async sendMail(@Req() req: Request, @Body() body: unknown) {
    const input = z
      .object({
        clientId: id,
        subject: text(150),
        body: text(10000),
        recipientIds: z.array(id).max(100).default([]),
        broadcast: z.boolean().default(false),
        replyToId: id.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.broadcast
            ? !value.recipientIds.length
            : value.recipientIds.length > 0,
        "Choose recipients or select all students.",
      )
      .parse(body);
    return this.mailbox.send(await this.service.actor(req), input);
  }
  @Patch("mailbox/:id") async mailboxUpdate(
    @Req() req: Request,
    @Param("id") message: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        read: z.boolean().optional(),
        starred: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine(
        (value) => Object.keys(value).length > 0,
        "Choose a mailbox action.",
      )
      .parse(body);
    return this.mailbox.update(
      await this.service.actor(req),
      id.parse(message),
      input,
    );
  }
  @Get("me") async me(@Req() req: Request, @Query("portal") portal: string) {
    const selected = z
      .enum(["student", "platform", "organization"])
      .parse(portal);
    return this.service.publicIdentity(
      await this.service.actor(req, portalRoles[selected], true),
    );
  }
  @Post("onboarding/password") async password(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = z
      .object({
        currentPassword: text(128),
        newPassword: z.string().min(12).max(128),
      })
      .strict()
      .refine(
        (v) => v.currentPassword !== v.newPassword,
        "Choose a different password.",
      )
      .parse(body);
    const actor = await this.service.actor(req, undefined, true);
    const result = await this.service.setPassword(
      actor,
      input.currentPassword,
      input.newPassword,
      req.headers,
    );
    const cookies = result.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    return { updated: true };
  }
  @Post("onboarding/phone") async phone(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) })
      .strict()
      .parse(body);
    return this.service.sendPhone(
      await this.service.actor(req, "student", true),
      input.phone,
    );
  }
  @Post("onboarding/phone/verify") async verify(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ challengeId: id, code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(body);
    return this.service.verifyPhone(
      await this.service.actor(req, "student", true),
      input.challengeId,
      input.code,
    );
  }
  @Get("platform/integrations") async integrations(@Req() req: Request) {
    await this.service.actor(req, "platform_admin");
    return this.service.integrations();
  }
  @Get("platform/summary") async summary(@Req() req: Request) {
    return this.service.summary(
      await this.service.actor(req, "platform_admin"),
    );
  }
  @Get("platform/organizations") async organizations(@Req() req: Request) {
    return this.service.organizations(
      await this.service.actor(req, "platform_admin"),
    );
  }
  @Post("platform/organizations") async createOrganization(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.createOrganization(
      await this.service.actor(req, "platform_admin"),
      z
        .object({ name: text(150) })
        .strict()
        .parse(body).name,
    );
  }
  @Get("platform/organizations/:id/members") async members(
    @Req() req: Request,
    @Param("id") organization: string,
  ) {
    return this.service.listMembers(
      await this.service.actor(req, "platform_admin"),
      id.parse(organization),
    );
  }
  @Post("platform/members") async createMember(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        organizationId: id,
        name: text(150),
        email: z
          .email()
          .max(200)
          .transform((v) => v.toLowerCase()),
        role: z.enum(["student", "organization_viewer"]),
      })
      .strict()
      .parse(body);
    return this.service.createMember(
      await this.service.actor(req, "platform_admin"),
      input,
    );
  }
  @Patch("platform/members/:id") async updateMember(
    @Req() req: Request,
    @Param("id") member: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        status: z.enum(["active", "suspended", "disabled"]).optional(),
        features: z
          .array(z.enum(["jobs", "resume", "rankings"]))
          .max(3)
          .optional(),
      })
      .strict()
      .parse(body);
    return this.service.updateMember(
      await this.service.actor(req, "platform_admin"),
      id.parse(member),
      input,
    );
  }
  @Get("platform/courses") async courses(@Req() req: Request) {
    return this.service.catalog(
      await this.service.actor(req, "platform_admin"),
    );
  }
  @Post("platform/courses") async createCourse(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.createCourse(
      await this.service.actor(req, "platform_admin"),
      courseInput.parse(body),
    );
  }
  @Get("platform/courses/:id") async platformCourse(
    @Req() req: Request,
    @Param("id") course: string,
  ) {
    return this.service.course(
      await this.service.actor(req, "platform_admin"),
      id.parse(course),
    );
  }
  @Post("platform/courses/:id/publish") async publish(
    @Req() req: Request,
    @Param("id") course: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        title: text(150),
        description: text(2000),
        lessons: z.array(lesson).min(1).max(200),
      })
      .strict()
      .refine(
        (v) =>
          new Set(v.lessons.flatMap((l) => (l.id ? [l.id] : []))).size ===
          v.lessons.filter((l) => l.id).length,
        "Lesson identifiers must be unique.",
      )
      .parse(body);
    return this.service.publishCourse(
      await this.service.actor(req, "platform_admin"),
      id.parse(course),
      input,
    );
  }
  @Post("platform/assignments") async assign(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z.object({ memberId: id, courseId: id }).strict().parse(body);
    return this.service.assign(
      await this.service.actor(req, "platform_admin"),
      input.memberId,
      input.courseId,
    );
  }
  @Get("platform/jobs") async jobs(
    @Req() req: Request,
    @Query("organizationId") organization: string,
  ) {
    return this.service.listJobs(
      await this.service.actor(req, "platform_admin"),
      id.parse(organization),
    );
  }
  @Post("platform/jobs") async createJob(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        organizationId: id,
        title: text(150),
        company: text(150),
        description: text(3000),
        url: z
          .url()
          .max(2000)
          .refine(
            (value) =>
              new URL(value).protocol === "https:" &&
              !new URL(value).username &&
              !new URL(value).password,
            "Use an HTTPS application link.",
          ),
      })
      .strict()
      .parse(body);
    return this.service.createJob(
      await this.service.actor(req, "platform_admin"),
      input,
    );
  }
  @Post("platform/uploads") async upload(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        contentType: z.enum([
          "application/pdf",
          "video/mp4",
          "application/vnd.apple.mpegurl",
        ]),
      })
      .strict()
      .parse(body);
    return this.service.upload(
      await this.service.actor(req, "platform_admin"),
      input.contentType,
    );
  }
  @Get("student/courses") async studentCourses(@Req() req: Request) {
    return this.service.catalog(await this.service.actor(req, "student"));
  }
  @Get("student/courses/:id") async studentCourse(
    @Req() req: Request,
    @Param("id") course: string,
  ) {
    return this.service.course(
      await this.service.actor(req, "student"),
      id.parse(course),
    );
  }
  @Post("student/courses/:id/lessons/:lesson/complete") async complete(
    @Req() req: Request,
    @Param("id") course: string,
    @Param("lesson") lessonId: string,
  ) {
    return this.service.completeLesson(
      await this.service.actor(req, "student"),
      id.parse(course),
      id.parse(lessonId),
    );
  }
  @Get("student/jobs") async studentJobs(@Req() req: Request) {
    return this.service.listJobs(await this.service.actor(req, "student"));
  }
  @Get("student/rankings") async rankings(@Req() req: Request) {
    return this.service.rankings(await this.service.actor(req, "student"));
  }
  @Get("student/resume") async resume(@Req() req: Request) {
    return this.service.getResume(await this.service.actor(req, "student"));
  }
  @Put("student/resume") async saveResume(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ data: resumeInput, revision: z.number().int().min(0) })
      .strict()
      .parse(body);
    return this.service.saveResume(
      await this.service.actor(req, "student"),
      input.data,
      input.revision,
    );
  }
  @Get("student/exams") async exams(@Req() req: Request) {
    return this.service.exams(await this.service.actor(req, "student"));
  }
  @Get("student/practice") async practice(@Req() req: Request) {
    return this.service.practice(await this.service.actor(req, "student"));
  }
  @Get("student/announcements") async announcements(@Req() req: Request) {
    return this.service.announcements(await this.service.actor(req, "student"));
  }
  @Get("platform/demo-preview") async demoPreview(
    @Req() req: Request,
    @Query("organizationId") organization: string,
  ) {
    return this.service.demoPreview(
      await this.service.actor(req, "platform_admin"),
      id.parse(organization),
    );
  }
  @Post("student/submissions") async submissions(@Req() req: Request) {
    await this.service.actor(req, "student");
    throw new ServiceUnavailableException(
      "Code execution will be enabled after the provider trial.",
    );
  }
  @Get("organization/analytics") async analytics(@Req() req: Request) {
    return this.service.analytics(
      await this.service.actor(req, "organization_viewer"),
    );
  }
}

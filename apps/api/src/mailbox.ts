import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import type {
  MailContact,
  MailFolder,
  MailMessage,
  MailPage,
  SendMail,
} from "@slate/contracts";
import { scoped, type Database, type Transaction } from "./database.js";
import type { Actor } from "./service.js";
import * as s from "./schema.js";

const projection = {
  message: s.messages,
  senderName: s.user.name,
  senderEmail: s.user.email,
  senderRole: s.members.role,
  recipientId: s.deliveries.recipientId,
  readAt: s.deliveries.readAt,
  starred: s.deliveries.starred,
  archivedAt: s.deliveries.archivedAt,
};
type Row = {
  message: typeof s.messages.$inferSelect;
  senderName: string;
  senderEmail: string;
  senderRole: string;
  recipientId: string | null;
  readAt: Date | null;
  starred: boolean | null;
  archivedAt: Date | null;
};

export class MailboxService {
  constructor(readonly db: Database) {}
  scope<T>(actor: Actor, work: (tx: Transaction) => Promise<T>) {
    if (
      !actor.organizationId ||
      !["student", "organization_viewer"].includes(actor.role)
    )
      throw new ForbiddenException(
        "Messaging is available to organization members only.",
      );
    return scoped(
      this.db,
      {
        authId: actor.authId,
        organizationId: actor.organizationId,
        mailbox: true,
      },
      work,
    );
  }
  async contacts(actor: Actor): Promise<MailContact[]> {
    return this.scope(actor, async (tx) => {
      const rows = await tx
        .select({
          id: s.members.id,
          name: s.user.name,
          email: s.user.email,
          role: s.members.role,
        })
        .from(s.members)
        .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
        .where(
          and(
            eq(s.members.organizationId, actor.organizationId!),
            eq(s.members.status, "active"),
            inArray(s.members.role, ["student", "organization_viewer"]),
          ),
        )
        .orderBy(s.user.name)
        .limit(10001);
      if (rows.length > 10000)
        throw new BadRequestException(
          "This directory needs server search before it can be opened.",
        );
      return rows as MailContact[];
    });
  }
  async format(
    tx: Transaction,
    rows: Row[],
    preview = false,
  ): Promise<MailMessage[]> {
    if (!rows.length) return [];
    const recipients = await tx
      .select({
        messageId: s.deliveries.messageId,
        id: s.members.id,
        name: s.user.name,
        email: s.user.email,
        role: s.members.role,
      })
      .from(s.deliveries)
      .innerJoin(s.members, eq(s.members.id, s.deliveries.recipientId))
      .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
      .where(
        inArray(
          s.deliveries.messageId,
          rows
            .filter((row) => !row.message.broadcast)
            .map((row) => row.message.id),
        ),
      )
      .orderBy(s.user.name);
    return rows.map((row) => ({
      id: row.message.id,
      subject: row.message.subject,
      body: preview ? row.message.body.slice(0, 180) : row.message.body,
      sender: {
        id: row.message.senderId,
        name: row.senderName,
        email: row.senderEmail,
        role: row.senderRole as MailContact["role"],
      },
      recipients: recipients
        .filter((recipient) => recipient.messageId === row.message.id)
        .map(({ messageId, ...recipient }) => recipient as MailContact),
      recipientCount: row.message.recipientCount,
      broadcast: row.message.broadcast,
      sentAt: row.message.sentAt.toISOString(),
      incoming: row.recipientId !== null,
      readAt: row.readAt?.toISOString() || null,
      starred: row.starred || false,
      archivedAt: row.archivedAt?.toISOString() || null,
      replyToId: row.message.replyToId,
    }));
  }
  async list(
    actor: Actor,
    input: { folder: MailFolder; search: string; page: number },
  ): Promise<MailPage> {
    return this.scope(actor, async (tx) => {
      const condition = and(
        input.folder === "sent"
          ? eq(s.messages.senderId, actor.id)
          : eq(s.deliveries.recipientId, actor.id),
        input.folder === "sent"
          ? undefined
          : input.folder === "archived"
            ? isNotNull(s.deliveries.archivedAt)
            : isNull(s.deliveries.archivedAt),
        input.folder === "unread" ? isNull(s.deliveries.readAt) : undefined,
        input.folder === "starred" ? eq(s.deliveries.starred, true) : undefined,
        input.search
          ? or(
              ilike(s.messages.subject, `%${input.search}%`),
              ilike(s.messages.body, `%${input.search}%`),
            )
          : undefined,
      );
      const receipt = and(
        eq(s.deliveries.messageId, s.messages.id),
        eq(s.deliveries.recipientId, actor.id),
      );
      const [total] = await tx
        .select({ value: count() })
        .from(s.messages)
        .leftJoin(s.deliveries, receipt)
        .where(condition);
      const page = Math.min(
        input.page,
        Math.max(1, Math.ceil(total.value / 20)),
      );
      const rows = await tx
        .select(projection)
        .from(s.messages)
        .leftJoin(s.deliveries, receipt)
        .innerJoin(s.members, eq(s.members.id, s.messages.senderId))
        .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
        .where(condition)
        .orderBy(desc(s.messages.sentAt), desc(s.messages.id))
        .limit(20)
        .offset((page - 1) * 20);
      const [unread] = await tx
        .select({ value: count() })
        .from(s.deliveries)
        .where(
          and(
            eq(s.deliveries.recipientId, actor.id),
            isNull(s.deliveries.readAt),
            isNull(s.deliveries.archivedAt),
          ),
        );
      return {
        items: await this.format(tx, rows, true),
        total: total.value,
        unreadCount: unread.value,
        page,
        pageSize: 20,
      };
    });
  }
  async detail(actor: Actor, id: string): Promise<MailMessage> {
    return this.scope(actor, async (tx) => {
      const rows = await tx
        .select(projection)
        .from(s.messages)
        .leftJoin(
          s.deliveries,
          and(
            eq(s.deliveries.messageId, s.messages.id),
            eq(s.deliveries.recipientId, actor.id),
          ),
        )
        .innerJoin(s.members, eq(s.members.id, s.messages.senderId))
        .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
        .where(eq(s.messages.id, id));
      if (!rows.length)
        throw new NotFoundException(
          "This message is not available in your mailbox.",
        );
      return (await this.format(tx, rows))[0];
    });
  }
  async send(actor: Actor, input: SendMail) {
    if (input.broadcast && actor.role !== "organization_viewer")
      throw new ForbiddenException(
        "Only organization admins can message all students.",
      );
    const requested = [...new Set(input.recipientIds)].sort();
    return this.scope(actor, async (tx) => {
      const match = (record: typeof s.messages.$inferSelect) => {
        if (
          record.subject !== input.subject ||
          record.body !== input.body ||
          record.broadcast !== input.broadcast ||
          record.replyToId !== (input.replyToId || null) ||
          JSON.stringify(record.requestedRecipients) !==
            JSON.stringify(requested)
        )
          throw new ConflictException(
            "This send request was already used for another message.",
          );
        return { id: record.id, recipientCount: record.recipientCount };
      };
      const [existing] = await tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.senderId, actor.id),
            eq(s.messages.clientId, input.clientId),
          ),
        );
      if (existing) return match(existing);
      const [recent] = await tx
        .select({ value: count() })
        .from(s.messages)
        .where(
          and(
            eq(s.messages.senderId, actor.id),
            gt(s.messages.sentAt, new Date(Date.now() - 60000)),
          ),
        );
      if (recent.value >= 10)
        throw new HttpException(
          "Please wait a minute before sending more messages.",
          429,
        );
      if (input.replyToId) {
        const [parent] = await tx
          .select({ id: s.messages.id })
          .from(s.messages)
          .where(eq(s.messages.id, input.replyToId));
        if (!parent)
          throw new NotFoundException(
            "The original message is not available in your mailbox.",
          );
      }
      const recipients = await tx
        .select({ id: s.members.id })
        .from(s.members)
        .where(
          and(
            eq(s.members.organizationId, actor.organizationId!),
            eq(s.members.status, "active"),
            input.broadcast
              ? eq(s.members.role, "student")
              : and(
                  inArray(s.members.role, ["student", "organization_viewer"]),
                  inArray(s.members.id, requested),
                ),
          ),
        )
        .limit(2001);
      if (!recipients.length)
        throw new BadRequestException(
          "Choose at least one active member of your organization.",
        );
      if (!input.broadcast && recipients.length !== requested.length)
        throw new BadRequestException(
          "Some recipients are unavailable or outside your organization. Check the recipient names.",
        );
      if (recipients.length > 2000)
        throw new BadRequestException(
          "This broadcast exceeds the current 2,000-student limit.",
        );
      const [message] = await tx
        .insert(s.messages)
        .values({
          organizationId: actor.organizationId!,
          senderId: actor.id,
          clientId: input.clientId,
          subject: input.subject,
          body: input.body,
          requestedRecipients: requested,
          broadcast: input.broadcast,
          recipientCount: recipients.length,
          replyToId: input.replyToId || null,
        })
        .onConflictDoNothing({
          target: [s.messages.senderId, s.messages.clientId],
        })
        .returning();
      if (!message) {
        const [concurrent] = await tx
          .select()
          .from(s.messages)
          .where(
            and(
              eq(s.messages.senderId, actor.id),
              eq(s.messages.clientId, input.clientId),
            ),
          );
        return match(concurrent);
      }
      await tx
        .insert(s.deliveries)
        .values(
          recipients.map((recipient) => ({
            organizationId: actor.organizationId!,
            messageId: message.id,
            senderId: actor.id,
            recipientId: recipient.id,
          })),
        );
      return { id: message.id, recipientCount: recipients.length };
    });
  }
  async update(
    actor: Actor,
    id: string,
    input: { read?: boolean; starred?: boolean; archived?: boolean },
  ) {
    return this.scope(actor, async (tx) => {
      const [delivery] = await tx
        .update(s.deliveries)
        .set({
          ...(input.read === undefined
            ? {}
            : { readAt: input.read ? new Date() : null }),
          ...(input.starred === undefined ? {} : { starred: input.starred }),
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
        })
        .where(
          and(
            eq(s.deliveries.messageId, id),
            eq(s.deliveries.recipientId, actor.id),
          ),
        )
        .returning({ id: s.deliveries.id });
      if (!delivery)
        throw new NotFoundException(
          "This message is not in your received mailbox.",
        );
      return { updated: true };
    });
  }
}

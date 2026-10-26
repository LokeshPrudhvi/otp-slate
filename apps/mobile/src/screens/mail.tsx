import { colors } from "../theme";
import { useEffect, useRef, useState } from "react";
import { View, FlatList } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import Markdown from "react-native-markdown-display";
import type {
  MailPage,
  MailMessage,
  MailContact,
  AnnouncementPage,
} from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Card,
  Button,
  Field,
  State,
  Chips,
  Badge,
  Notice,
  Icon,
  IconButton,
  Select,
  s,
} from "../components/ui";
import { EmptyFeature } from "../components/learning";
import { usePage, useFeature, useSession } from "../lib/session";
import { api } from "../lib/api";
export function InboxScreen() {
  const allowed = useFeature("inbox"),
    [folder, setFolder] = useState("inbox"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFilter(search), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: ["native", "mailbox", folder, filter],
    initialPageParam: 1,
    enabled: allowed,
    queryFn: ({ pageParam }) =>
      api<MailPage>(
        `mailbox?folder=${folder}&search=${encodeURIComponent(filter)}&page=${pageParam}`,
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  return (
    <Screen
      back
      title="Inbox"
      scroll={false}
      style={{ flex: 1 }}
      actions={
        allowed ? (
          <IconButton
            name="edit"
            label="Compose message"
            onPress={() => router.push("/compose")}
          />
        ) : undefined
      }
    >
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Field label="Search mail" value={search} onChangeText={setSearch} />
          <Chips
            value={folder}
            onChange={setFolder}
            items={["inbox", "unread", "starred", "sent", "archived"].map(
              (value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              }),
            )}
          />
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          <FlatList
            data={query.data?.pages.flatMap((page) => page.items) || []}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ gap: 10, paddingBottom: 22 }}
            onEndReached={() => {
              if (query.hasNextPage && !query.isFetchingNextPage)
                void query.fetchNextPage();
            }}
            renderItem={({ item }) => (
              <Card onPress={() => router.push(`/inbox/${item.id}`)}>
                <View style={[s.row, { justifyContent: "space-between" }]}>
                  <Label
                    style={{ fontWeight: item.readAt ? "500" : "700", flex: 1 }}
                  >
                    {item.sender.name}
                  </Label>
                  {!item.readAt && item.incoming && (
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        backgroundColor: colors.primary,
                      }}
                    />
                  )}
                  <Label muted style={{ fontSize: 11 }}>
                    {new Date(item.sentAt).toLocaleDateString()}
                  </Label>
                </View>
                <Label style={{ fontWeight: "700" }}>{item.subject}</Label>
                <Label muted numberOfLines={2}>
                  {item.body}
                </Label>
              </Card>
            )}
          />
        </>
      )}
    </Screen>
  );
}
export function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<MailMessage>(`mailbox/${id}`),
    client = useQueryClient();
  const change = useMutation({
    mutationFn: (input: { starred?: boolean; archived?: boolean }) =>
      api(`mailbox/${id}`, "PATCH", input),
    onSuccess: () => {
      void query.refetch();
      void client.invalidateQueries({ queryKey: ["native", "mailbox"] });
    },
  });
  return (
    <Screen back title="Message">
      <State
        pending={query.isPending}
        error={query.error || change.error}
        onRetry={() => void query.refetch()}
      />
      {query.data && (
        <>
          <Title>{query.data.subject}</Title>
          <Card>
            <Label style={{ fontWeight: "700" }}>
              {query.data.sender.name}
            </Label>
            <Label muted>{query.data.sender.email}</Label>
            <Label muted>{new Date(query.data.sentAt).toLocaleString()}</Label>
            <Label muted>
              To: {query.data.recipients.map((p) => p.name).join(", ")}
            </Label>
          </Card>
          <Label>{query.data.body}</Label>
          <Button
            title="Reply"
            onPress={() =>
              router.push({
                pathname: "/compose",
                params: {
                  replyToId: id,
                  to: query.data!.sender.id,
                  subject: `Re: ${query.data!.subject}`,
                },
              })
            }
          />
          <View style={s.row}>
            <Button
              title={query.data.starred ? "Unstar" : "Star"}
              secondary
              onPress={() => change.mutate({ starred: !query.data!.starred })}
              style={{ flex: 1 }}
            />
            <Button
              title={query.data.archivedAt ? "Restore" : "Archive"}
              secondary
              onPress={() =>
                change.mutate({ archived: !query.data!.archivedAt })
              }
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
export function ComposeScreen() {
  const params = useLocalSearchParams<{
      replyToId?: string;
      to?: string;
      subject?: string;
    }>(),
    contacts = usePage<MailContact[]>("mailbox/contacts"),
    { me } = useSession(),
    client = useQueryClient();
  const [recipients, setRecipients] = useState<string[]>(
      params.to ? [params.to] : [],
    ),
    [choice, setChoice] = useState(""),
    [subject, setSubject] = useState(params.subject || ""),
    [body, setBody] = useState("");
  const id = useRef(randomUUID());
  const send = useMutation({
    mutationFn: () =>
      api("mailbox", "POST", {
        clientId: id.current,
        recipientIds: recipients,
        subject,
        body,
        broadcast: false,
        replyToId: params.replyToId,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["native", "mailbox"] });
      router.back();
    },
  });
  return (
    <Screen back title="New message">
      <Notice>{me?.organizationName} · Organization members only</Notice>
      <State
        pending={contacts.isPending}
        error={contacts.error}
        onRetry={() => void contacts.refetch()}
      />
      <Select
        label="Find a recipient by name"
        value={choice}
        options={(contacts.data || [])
          .filter((c) => !recipients.includes(c.id))
          .map((c) => ({ value: c.id, label: `${c.name} · ${c.email}` }))}
        onChange={(value) => {
          setRecipients([...recipients, value]);
          setChoice("");
        }}
      />
      {recipients.map((id) => (
        <Card
          key={id}
          onPress={() => setRecipients(recipients.filter((v) => v !== id))}
          style={s.row}
        >
          <Icon name="user" />
          <Label style={{ flex: 1 }}>
            {contacts.data?.find((c) => c.id === id)?.name || "Recipient"}
          </Label>
          <Icon name="x" />
        </Card>
      ))}
      <Field
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        maxLength={150}
      />
      <Field
        label="Message"
        value={body}
        onChangeText={setBody}
        multiline
        style={{ minHeight: 220 }}
        maxLength={10000}
      />
      {send.error && <Notice error>{send.error.message}</Notice>}
      <Button
        title="Send message"
        icon="send"
        loading={send.isPending}
        disabled={!recipients.length || !subject.trim() || !body.trim()}
        onPress={() => send.mutate()}
      />
    </Screen>
  );
}
export function AnnouncementsScreen() {
  const allowed = useFeature("announcements"),
    [page, setPage] = useState(1),
    query = usePage<AnnouncementPage>(`announcements?page=${page}`, allowed),
    [open, setOpen] = useState<string | null>(null);
  return (
    <Screen back title="Announcements">
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Title>Stay in the loop.</Title>
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          {query.data?.items.map((a) => (
            <Card
              key={a.id}
              onPress={() => setOpen(open === a.id ? null : a.id)}
            >
              <Badge tone="purple">{a.branchName || "Organization"}</Badge>
              <Title>{a.title}</Title>
              <Label muted>{new Date(a.createdAt).toLocaleDateString()}</Label>
              {open === a.id ? (
                a.format === "markdown" ? (
                  <Markdown>{a.body}</Markdown>
                ) : (
                  <Label>{a.body}</Label>
                )
              ) : (
                <Label muted>{a.body.slice(0, 140)}…</Label>
              )}
            </Card>
          ))}
          <View style={s.row}>
            <Button
              title="Previous"
              secondary
              disabled={page === 1}
              onPress={() => setPage(page - 1)}
              style={{ flex: 1 }}
            />
            <Button
              title="Next"
              secondary
              disabled={
                !query.data || page * query.data.pageSize >= query.data.total
              }
              onPress={() => setPage(page + 1)}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  MailContact,
  MailFolder,
  MailMessage,
  MailPage,
} from "@slate/contracts";
import { api, Select } from "@slate/ui";
import { Heading, NoResults, Status } from "./design";
import { useStudentData } from "./access";
import "./mailbox.css";
export function MailboxPage() {
  const query = useQueryClient();
  const [folder, setFolder] = useState<MailFolder>("inbox"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [compose, setCompose] = useState(false),
    [recipient, setRecipient] = useState(""),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [clientId, setClientId] = useState(() => crypto.randomUUID()),
    [sent, setSent] = useState(""),
    [replyToId, setReplyToId] = useState<string | undefined>();
  const list = useStudentData<MailPage>(
    `mailbox:${folder}:${search}:${page}`,
    `mailbox?folder=${folder}&search=${encodeURIComponent(search)}&page=${page}`,
  );
  const detail = useStudentData<MailMessage>(
    `mailbox-detail:${selected}`,
    `mailbox/${selected}`,
    Boolean(selected) && !compose,
  );
  const contacts = useStudentData<MailContact[]>(
    "mailbox-contacts",
    "mailbox/contacts",
    compose,
  );
  const refresh = () =>
    query.invalidateQueries({
      predicate: (item) =>
        item.queryKey[0] === "student" &&
        String(item.queryKey[1]).startsWith("mailbox"),
    });
  const update = useMutation({
    mutationFn: ({
      id,
      ...value
    }: {
      id: string;
      read?: boolean;
      starred?: boolean;
      archived?: boolean;
    }) => api(`mailbox/${id}`, "PATCH", value),
    onSuccess: () => void refresh(),
  });
  const send = useMutation({
    mutationFn: () =>
      api("mailbox", "POST", {
        clientId,
        subject,
        body,
        recipientIds: [recipient],
        broadcast: false,
        ...(replyToId ? { replyToId } : {}),
      }),
    onSuccess: () => {
      setCompose(false);
      setSent("Message sent.");
      setSubject("");
      setBody("");
      setRecipient("");
      setReplyToId(undefined);
      setClientId(crypto.randomUUID());
      void refresh();
    },
  });
  const folders: MailFolder[] = [
    "inbox",
    "unread",
    "starred",
    "sent",
    "archived",
  ];
  const message = detail.data;
  return (
    <div className="a-page student-mailbox">
      <Heading title="Inbox">
        <button
          className="a-btn pri"
          onClick={() => {
            setCompose(true);
            setReplyToId(undefined);
            setSent("");
            send.reset();
          }}
        >
          ＋ Compose
        </button>
      </Heading>
      <div className="mailbox-toolbar">
        <nav aria-label="Mailbox folders">
          {folders.map((item) => (
            <button
              key={item}
              className={`a-pill${folder === item ? " on" : ""}`}
              aria-pressed={folder === item}
              onClick={() => {
                setFolder(item);
                setPage(1);
                setSelected(null);
                setCompose(false);
              }}
            >
              {item[0].toUpperCase() + item.slice(1)}
              {item === "inbox" &&
                Boolean(list.data?.unreadCount) &&
                ` (${list.data?.unreadCount})`}
            </button>
          ))}
        </nav>
        <input
          type="search"
          className="a-search"
          aria-label="Search messages"
          maxLength={150}
          placeholder="Search your mailbox…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {sent && (
        <p role="status" className="mailbox-notice">
          {sent}
        </p>
      )}
      <Status pending={false} error={update.error} />
      <div className="mailbox-layout">
        <section className="mailbox-list" aria-label="Message list">
          <Status pending={list.isPending} error={list.error} />
          {list.data && !list.data.items.length && (
            <NoResults title="No messages">
              Messages in this folder will appear here.
            </NoResults>
          )}
          {list.data?.items.map((item) => (
            <button
              key={item.id}
              className={`mailbox-preview${selected === item.id && !compose ? " selected" : ""}${item.incoming && !item.readAt ? " unread" : ""}`}
              aria-pressed={selected === item.id && !compose}
              onClick={() => {
                setSelected(item.id);
                setCompose(false);
                if (item.incoming && !item.readAt)
                  update.mutate({ id: item.id, read: true });
              }}
            >
              <span className="mailbox-preview-meta">
                <b>
                  {folder === "sent"
                    ? item.broadcast
                      ? "All students"
                      : item.recipients.map((person) => person.name).join(", ")
                    : item.sender.name}
                </b>
                <time dateTime={item.sentAt}>
                  {new Date(item.sentAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
              </span>
              <strong>{item.subject}</strong>
              <p>{item.body}</p>
            </button>
          ))}
          {list.data && list.data.total > list.data.pageSize && (
            <div className="mailbox-pagination">
              <button
                className="a-btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ←
              </button>
              <span>
                {list.data.page} /{" "}
                {Math.ceil(list.data.total / list.data.pageSize)}
              </span>
              <button
                className="a-btn"
                disabled={page * list.data.pageSize >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                →
              </button>
            </div>
          )}
        </section>
        <section
          className="mailbox-reader"
          aria-label={compose ? "Compose message" : "Read message"}
        >
          {compose ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send.mutate();
              }}
              className="mailbox-compose"
            >
              <h2>New message</h2>
              <Status pending={contacts.isPending} error={contacts.error} />
              <label>
                To
                <Select
                  value={recipient}
                  onChange={(value) => {
                    setRecipient(value);
                    setClientId(crypto.randomUUID());
                  }}
                  searchable
                  aria-label="Message recipient"
                  options={(contacts.data ?? []).map((person) => ({
                    value: person.id,
                    label: `${person.name} · ${person.email}`,
                  }))}
                  placeholder="Find a name in your organization"
                />
              </label>
              <label>
                Subject
                <input
                  value={subject}
                  maxLength={150}
                  required
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setClientId(crypto.randomUUID());
                  }}
                />
              </label>
              <label>
                Message
                <textarea
                  value={body}
                  maxLength={10000}
                  rows={12}
                  required
                  onChange={(event) => {
                    setBody(event.target.value);
                    setClientId(crypto.randomUUID());
                  }}
                />
              </label>
              <Status pending={false} error={send.error} />
              <div className="mailbox-actions">
                <button
                  className="a-btn pri"
                  disabled={
                    !recipient ||
                    !subject.trim() ||
                    !body.trim() ||
                    send.isPending
                  }
                >
                  {send.isPending ? "Sending…" : "Send message →"}
                </button>
                <button
                  type="button"
                  className="a-btn"
                  onClick={() => setCompose(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <>
              <Status pending={detail.isPending} error={detail.error} />
              {message && (
                <>
                  <header className="mailbox-message-header">
                    <div className="mailbox-actions">
                      {message.incoming && (
                        <>
                          <button
                            className="a-btn"
                            disabled={update.isPending}
                            onClick={() =>
                              update.mutate({
                                id: message.id,
                                starred: !message.starred,
                              })
                            }
                          >
                            {message.starred ? "★ Starred" : "☆ Star"}
                          </button>
                          <button
                            className="a-btn"
                            disabled={update.isPending}
                            onClick={() => {
                              update.mutate({
                                id: message.id,
                                archived: !message.archivedAt,
                              });
                              setSelected(null);
                            }}
                          >
                            {message.archivedAt ? "Move to inbox" : "Archive"}
                          </button>
                        </>
                      )}
                    </div>
                    <h2>{message.subject}</h2>
                    <p>
                      <b>{message.sender.name}</b> &lt;{message.sender.email}
                      &gt;
                    </p>
                    <p>
                      To:{" "}
                      {message.broadcast
                        ? "All students"
                        : message.recipients
                            .map((person) => person.name)
                            .join(", ")}
                    </p>
                    <time dateTime={message.sentAt}>
                      {new Date(message.sentAt).toLocaleString("en-IN")}
                    </time>
                  </header>
                  <div className="mailbox-message-body">{message.body}</div>
                  {message.incoming && (
                    <button
                      className="a-btn"
                      onClick={() => {
                        setRecipient(message.sender.id);
                        setReplyToId(message.id);
                        setSubject(`Re: ${message.subject}`.slice(0, 150));
                        setBody("");
                        setClientId(crypto.randomUUID());
                        setCompose(true);
                      }}
                    >
                      Reply →
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="mailbox-idle">
              <span aria-hidden="true">✉</span>
              <h2>Your organization mailbox</h2>
              <p>Select a message to read the full conversation.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

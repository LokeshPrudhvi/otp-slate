import { useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import Pdf from "react-native-pdf";
import {
  crtSubjects,
  type CrtSubjectId,
  type CrtStudentTopic,
  type CrtStudentTopicDetail,
  type CrtResult,
  type CrtPracticeSession,
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
  Select,
  s,
  Progress,
} from "../components/ui";
import { Choices, EmptyFeature } from "../components/learning";
import { ProgressRing } from "../components/progress-ring";
import { usePage, useFeature } from "../lib/session";
import { api, safeExternalUrl } from "../lib/api";
import { colors, subjectStyle } from "../theme";
export function CrtScreen() {
  const allowed = useFeature("crt"),
    query = usePage<CrtStudentTopic[]>("student/crt/topics", allowed);
  return (
    <Screen back title="CRT">
      <Title>Campus Recruitment Training</Title>
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Card style={{ backgroundColor: colors.primary }}>
            <Icon name="target" color="#FFE169" size={34} />
            <Label style={{ fontSize: 22, fontWeight: "700", color: "#fff" }}>
              Put your skills into practice.
            </Label>
            <Label style={{ color: "#C8D6E8" }}>
              Build a practice session from your assigned topics.
            </Label>
            <Button
              title="Start practice"
              secondary
              style={{ backgroundColor: "#fff" }}
              onPress={() => router.push("/crt/practice")}
            />
          </Card>
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          {crtSubjects.map((subject) => {
            const topics = (query.data || []).filter(
                (t) => t.subjectId === subject.id,
              ),
              completed = topics.filter((t) => t.completed).length,
              style = subjectStyle[subject.id];
            return (
              <Card
                key={subject.id}
                onPress={() => router.push(`/crt/subjects/${subject.id}`)}
                style={{ backgroundColor: style.background }}
              >
                <View style={[s.row, { justifyContent: "space-between" }]}>
                  <Icon name={style.icon} color={style.color} size={28} />
                  <Badge
                    tone={
                      subject.id === "reasoning"
                        ? "purple"
                        : subject.id === "soft-skills"
                          ? "amber"
                          : "teal"
                    }
                  >
                    {completed}/{topics.length} topics
                  </Badge>
                </View>
                <Label style={{ fontSize: 21, fontWeight: "700" }}>
                  {subject.name}
                </Label>
                <Progress
                  value={topics.length ? completed / topics.length : 0}
                  color={style.color}
                />
                <Label style={{ color: style.color, fontWeight: "600" }}>
                  Explore topics →
                </Label>
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
export function CrtSubjectScreen() {
  const { subject } = useLocalSearchParams<{ subject: CrtSubjectId }>(),
    query = usePage<CrtStudentTopic[]>("student/crt/topics");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const topics = (query.data || []).filter((t) => t.subjectId === subject),
    rows = topics.filter(
      (t) =>
        t.title.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "all" || (filter === "completed") === t.completed),
    );
  return (
    <Screen back title="CRT topics">
      <Title>
        {crtSubjects.find((s) => s.id === subject)?.name || "Topics"}
      </Title>
      <Label muted>
        {topics.filter((t) => t.completed).length} of {topics.length} completed
      </Label>
      <Field
        label="Find a topic"
        placeholder="Search topics"
        value={search}
        onChangeText={setSearch}
      />
      <Chips
        value={filter}
        onChange={setFilter}
        items={[
          { value: "all", label: "All" },
          { value: "remaining", label: "To do" },
          { value: "completed", label: "Completed" },
        ]}
      />
      <State
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={
          !query.isPending && !query.error && !rows.length
            ? "No matching topics"
            : undefined
        }
      />
      {rows.map((topic) => (
        <Card
          key={topic.id}
          onPress={() => router.push(`/crt/topics/${topic.id}`)}
          style={s.row}
        >
          <Badge>{String(topics.indexOf(topic) + 1).padStart(2, "0")}</Badge>
          <View style={{ flex: 1, gap: 4 }}>
            <Label style={{ fontWeight: "700" }}>{topic.title}</Label>
            <Label muted style={{ fontSize: 12 }}>
              {topic.questionCount} questions · Pass {topic.passingScore}%
            </Label>
          </View>
          <Icon
            name={topic.completed ? "check-circle" : "chevron-right"}
            color={topic.completed ? colors.teal : colors.muted}
          />
        </Card>
      ))}
    </Screen>
  );
}
export function CrtTopicScreen() {
  const params = useLocalSearchParams<{
    id: string;
    courseId: string;
    lessonId: string;
    sessionId?: string;
  }>();
  return <CrtTopicContent key={params.id} />;
}
function CrtTopicContent() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<CrtStudentTopicDetail>(`student/crt/topics/${id}`),
    pdf = usePage<{ url: string }>(`student/crt/topics/${id}/pdf`);
  const [tab, setTab] = useState("study"),
    [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [read, setRead] = useState(false),
    [pdfError, setPdfError] = useState<Error | null>(null),
    [expanded, setExpanded] = useState(false);
  const clientId = useRef(randomUUID()),
    client = useQueryClient();
  const submit = useMutation({
    mutationFn: () =>
      api<CrtResult>(`student/crt/topics/${id}/submit`, "POST", {
        versionId: query.data!.versionId,
        clientId: clientId.current,
        answers,
        readAcknowledged: true,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["native", "student/crt/topics"] }),
  });
  const topic = query.data,
    q = topic?.questions[index];
  if (submit.data)
    return (
      <Screen back title="Topic result">
        <Card style={{ alignItems: "center" }}>
          <ProgressRing
            value={submit.data.correct}
            total={submit.data.total}
            label="Correct"
            color={submit.data.passed ? colors.teal : colors.amber}
          />
          <Title>
            {submit.data.passed ? "Topic completed!" : "Keep practising"}
          </Title>
          <Label>
            Score {submit.data.score}% · Pass mark {topic?.passingScore}%
          </Label>
          <Label muted>
            {submit.data.passed
              ? "Your progress has been updated."
              : "Review the explanations and give it another try."}
          </Label>
        </Card>
        {submit.data.questions.map((q, i) => (
          <Card key={q.id}>
            <Label style={{ fontWeight: "700" }}>
              {i + 1}. {q.prompt}
            </Label>
            <Label>Correct answer: {q.options[q.correctOption!]}</Label>
            <Label muted>{q.explanation}</Label>
          </Card>
        ))}
        <Button title="Back to topics" onPress={() => router.back()} />
        <Button
          title="Try again"
          secondary
          onPress={() => {
            submit.reset();
            setAnswers({});
            setIndex(0);
            clientId.current = randomUUID();
          }}
        />
      </Screen>
    );
  return (
    <Screen
      back
      title={expanded ? "Study material" : topic?.title || "CRT topic"}
      scroll={tab !== "study"}
      style={tab === "study" ? { flex: 1, paddingTop: 4 } : undefined}
    >
      {!expanded && (
        <Chips
          value={tab}
          onChange={setTab}
          items={[
            { value: "study", label: "Study material" },
            { value: "assessment", label: "Assessment" },
          ]}
        />
      )}
      <State
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {topic &&
        (tab === "study" ? (
          <>
            <View style={[s.row, { justifyContent: "space-between" }]}>
              <Label muted>{topic.pdf.fileName}</Label>
              <Button
                title={expanded ? "Reduce" : "Expand"}
                secondary
                onPress={() => setExpanded(!expanded)}
              />
            </View>
            <State
              pending={pdf.isPending}
              error={pdf.error || pdfError}
              onRetry={() => {
                setPdfError(null);
                void pdf.refetch();
              }}
            />
            {pdf.data && !pdfError && (
              <Pdf
                source={{ uri: safeExternalUrl(pdf.data.url), cache: false }}
                trustAllCerts={false}
                enablePaging={false}
                onError={(error) => setPdfError(new Error(String(error)))}
                style={{
                  flex: 1,
                  minHeight: 180,
                  width: "100%",
                  backgroundColor: "#E3E8EF",
                }}
              />
            )}
          </>
        ) : (
          <>
            <Title>Check your understanding</Title>
            <Label muted>
              {index + 1} of {topic.questions.length} ·{" "}
              {Object.keys(answers).length} answered
            </Label>
            {q && (
              <Choices
                question={q}
                value={answers[q.id]}
                onChange={(value) => setAnswers({ ...answers, [q.id]: value })}
                imagePath={`student/crt/topics/${id}/images/${q.image?.uploadId}`}
              />
            )}
            <View style={s.row}>
              <Button
                title="Previous"
                secondary
                disabled={index === 0}
                onPress={() => setIndex(index - 1)}
                style={{ flex: 1 }}
              />
              <Button
                title="Next"
                secondary
                disabled={index === topic.questions.length - 1}
                onPress={() => setIndex(index + 1)}
                style={{ flex: 1 }}
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: read }}
              onPress={() => setRead(!read)}
              style={[s.row, { paddingVertical: 12 }]}
            >
              <Icon name={read ? "check-square" : "square"} />
              <Label style={{ flex: 1 }}>I have read the study material.</Label>
            </Pressable>
            {submit.error && <Notice error>{submit.error.message}</Notice>}
            <Button
              title="Submit assessment"
              disabled={
                !read || Object.keys(answers).length !== topic.questions.length
              }
              loading={submit.isPending}
              onPress={() => submit.mutate()}
            />
          </>
        ))}
    </Screen>
  );
}
export function CrtPracticeScreen() {
  const params = useLocalSearchParams<{
    id: string;
    courseId: string;
    lessonId: string;
    sessionId?: string;
  }>();
  return <CrtPracticeContent key={params.sessionId || "setup"} />;
}
function CrtPracticeContent() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>(),
    topics = usePage<CrtStudentTopic[]>("student/crt/topics", !sessionId),
    session = usePage<CrtPracticeSession>(
      `student/crt/practice/${sessionId}`,
      Boolean(sessionId),
    );
  const [subject, setSubject] = useState("quantitative"),
    [selected, setSelected] = useState<string[]>([]),
    [count, setCount] = useState("10"),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [index, setIndex] = useState(0);
  const start = useMutation({
    mutationFn: () =>
      api<CrtPracticeSession>("student/crt/practice", "POST", {
        subjectId: subject,
        topicIds: selected.length ? selected : undefined,
        count: Number(count),
      }),
    onSuccess: (data) => router.replace(`/crt/practice?sessionId=${data.id}`),
  });
  const submit = useMutation({
    mutationFn: () =>
      api<CrtResult>(`student/crt/practice/${sessionId}/submit`, "POST", {
        answers,
      }),
  });
  const result = submit.data || session.data?.result,
    q = session.data?.questions[index];
  if (result)
    return (
      <Screen back title="Practice result">
        <ProgressRing
          value={result.correct}
          total={result.total}
          label="Correct"
        />
        <Title>Your practice results</Title>
        {result.questions.map((q) => (
          <Card key={q.id}>
            <Label>{q.prompt}</Label>
            <Label>Answer: {q.options[q.correctOption!]}</Label>
            <Label muted>{q.explanation}</Label>
          </Card>
        ))}
        <Button
          title="Practise again"
          onPress={() => router.replace("/crt/practice")}
        />
      </Screen>
    );
  return (
    <Screen back title="CRT practice">
      {sessionId ? (
        <>
          <State
            pending={session.isPending}
            error={session.error}
            onRetry={() => void session.refetch()}
          />
          {q && (
            <>
              <Label muted>
                Question {index + 1} of {session.data!.questions.length}
              </Label>
              <Choices
                question={q}
                value={answers[q.id]}
                onChange={(value) => setAnswers({ ...answers, [q.id]: value })}
                imagePath={`student/crt/practice/${sessionId}/images/${q.image?.uploadId}`}
              />
              <View style={s.row}>
                <Button
                  title="Previous"
                  secondary
                  disabled={index === 0}
                  onPress={() => setIndex(index - 1)}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Next"
                  disabled={index === session.data!.questions.length - 1}
                  onPress={() => setIndex(index + 1)}
                  style={{ flex: 1 }}
                />
              </View>
              {submit.error && <Notice error>{submit.error.message}</Notice>}
              <Button
                title="Finish practice"
                loading={submit.isPending}
                disabled={
                  Object.keys(answers).length !== session.data!.questions.length
                }
                onPress={() => submit.mutate()}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Title>Build your practice session</Title>
          <Select
            label="Subject"
            value={subject}
            options={crtSubjects.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(value) => {
              setSubject(value);
              setSelected([]);
            }}
          />
          <Label muted>
            Choose topics, or leave all unchecked to use this subject.
          </Label>
          <State pending={topics.isPending} error={topics.error} />
          {topics.data
            ?.filter((t) => t.subjectId === subject)
            .map((t) => (
              <Card
                key={t.id}
                onPress={() =>
                  setSelected(
                    selected.includes(t.id)
                      ? selected.filter((id) => id !== t.id)
                      : [...selected, t.id],
                  )
                }
                style={s.row}
              >
                <Icon
                  name={selected.includes(t.id) ? "check-square" : "square"}
                />
                <Label style={{ flex: 1 }}>{t.title}</Label>
              </Card>
            ))}
          <Select
            label="Number of questions"
            value={count}
            onChange={setCount}
            options={["10", "20", "50"].map((n) => ({ value: n, label: n }))}
          />
          {start.error && <Notice error>{start.error.message}</Notice>}
          <Button
            title="Start practice"
            loading={start.isPending}
            disabled={!topics.data?.some((t) => t.subjectId === subject)}
            onPress={() => start.mutate()}
          />
        </>
      )}
    </Screen>
  );
}

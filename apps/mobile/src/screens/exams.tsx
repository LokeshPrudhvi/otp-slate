import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Modal,
  AppState,
  Alert,
} from "react-native";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { useKeepAwake } from "expo-keep-awake";
import { usePreventScreenCapture } from "expo-screen-capture";
import * as Network from "expo-network";
import type {
  StudentExamSummary,
  StudentExamDetail,
  ExamAttemptView,
  ExamAnswer,
  ExamMonitorEvent,
  ExamLanguage,
} from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Card,
  Button,
  State,
  Chips,
  Badge,
  Notice,
  Icon,
  Select,
  s,
} from "../components/ui";
import { Choices, EmptyFeature } from "../components/learning";
import { CodeEditor } from "../components/code-editor";
import { usePage, useFeature, useSession } from "../lib/session";
import { api } from "../lib/api";
export function ExamsScreen() {
  const allowed = useFeature("live-exams"),
    query = usePage<StudentExamSummary[]>("student/exams", allowed),
    [tab, setTab] = useState("live");
  const rows = (query.data || []).filter((e) =>
    tab === "live"
      ? e.state === "live" &&
        (!e.attemptStatus || e.attemptStatus === "in_progress")
      : tab === "upcoming"
        ? e.state === "upcoming"
        : Boolean(e.attemptId && e.attemptStatus !== "in_progress"),
  );
  return (
    <Screen back title="Live exams">
      <Title>Show what you know.</Title>
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Chips
            value={tab}
            onChange={setTab}
            items={[
              { value: "live", label: "Live" },
              { value: "upcoming", label: "Upcoming" },
              { value: "results", label: "Results" },
            ]}
          />
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
            empty={
              !query.isPending && !query.error && !rows.length
                ? tab === "live"
                  ? "No live exams right now"
                  : tab === "upcoming"
                    ? "No upcoming exams"
                    : "No results yet"
                : undefined
            }
          />
          {rows.map((e) => (
            <Card
              key={e.id}
              style={{ maxWidth: 540, width: "100%", alignSelf: "center" }}
            >
              <Badge
                tone={
                  tab === "live"
                    ? "teal"
                    : tab === "upcoming"
                      ? "purple"
                      : "amber"
                }
              >
                {tab === "live"
                  ? "Live now"
                  : tab === "upcoming"
                    ? "Scheduled"
                    : e.resultsReleased
                      ? "Results released"
                      : "Awaiting results"}
              </Badge>
              <Title>{e.title}</Title>
              <Label muted>
                {e.durationMinutes} min · {e.questionCount} questions
              </Label>
              <Label muted>{new Date(e.startsAt).toLocaleString()}</Label>
              <Button
                title={
                  tab === "results"
                    ? "View result"
                    : tab === "upcoming"
                      ? "Exam schedule"
                      : e.attemptId
                        ? "Resume exam"
                        : "View exam"
                }
                secondary={tab === "upcoming"}
                onPress={() =>
                  router.push(
                    tab === "results"
                      ? `/attempts/${e.attemptId}`
                      : `/exams/${e.id}`,
                  )
                }
              />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
export function ExamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<StudentExamDetail>(`student/exams/${id}`),
    [consent, setConsent] = useState(false);
  const start = useMutation({
    mutationFn: () =>
      api<ExamAttemptView>(`student/exams/${id}/attempt`, "POST", {}),
    onSuccess: (a) => router.replace(`/attempts/${a.id}`),
  });
  const exam = query.data;
  return (
    <Screen back title="Before you begin">
      <State
        pending={query.isPending}
        error={query.error || start.error}
        onRetry={() => void query.refetch()}
      />
      {exam && (
        <>
          <Title>{exam.title}</Title>
          <Badge tone={exam.state === "live" ? "teal" : "purple"}>
            {exam.state}
          </Badge>
          <Card>
            <Label>
              {exam.durationMinutes} minutes · {exam.questionCount} questions
            </Label>
            <Label>Starts: {new Date(exam.startsAt).toLocaleString()}</Label>
            <Label>Ends: {new Date(exam.endsAt).toLocaleString()}</Label>
            <Label>Pass mark: {exam.passingPercentage}%</Label>
          </Card>
          <Label>{exam.instructions || exam.description}</Label>
          {exam.monitoring.enabled && (
            <Notice>
              Leaving this app or losing connection may be recorded for review.
              This does not prove cheating. Coding answers are reviewed manually
              when configured by your administrator.
            </Notice>
          )}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            onPress={() => setConsent(!consent)}
            style={[s.row, { paddingVertical: 12 }]}
          >
            <Icon name={consent ? "check-square" : "square"} />
            <Label style={{ flex: 1 }}>
              I understand the instructions and agree to the exam monitoring
              rules.
            </Label>
          </Pressable>
          <Button
            title={exam.attemptId ? "Resume exam" : "Start timed exam"}
            disabled={exam.state !== "live" || !consent}
            loading={start.isPending}
            onPress={() =>
              exam.attemptId
                ? router.replace(`/attempts/${exam.attemptId}`)
                : start.mutate()
            }
          />
        </>
      )}
    </Screen>
  );
}
export function ExamAttemptScreen() {
  const params = useLocalSearchParams<{
    id: string;
    courseId: string;
    lessonId: string;
    sessionId?: string;
  }>();
  return <ExamAttemptContent key={params.id} />;
}
function ExamAttemptContent() {
  useKeepAwake();
  usePreventScreenCapture("slate-exam");
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<ExamAttemptView>(`student/exam-attempts/${id}`),
    { me } = useSession(),
    [allowLeave, setAllowLeave] = useState(false);
  const [view, setView] = useState<ExamAttemptView | null>(null),
    [answers, setAnswers] = useState<ExamAnswer[]>([]),
    [index, setIndex] = useState(0),
    [navigator, setNavigator] = useState(false),
    [flags, setFlags] = useState<string[]>([]),
    [error, setError] = useState<Error | null>(null),
    [saving, setSaving] = useState(false),
    [remaining, setRemaining] = useState(0),
    [ready, setReady] = useState(false),
    [finishing, setFinishing] = useState(false);
  const ref = useRef<{
    view: ExamAttemptView | null;
    answers: ExamAnswer[];
    chain: Promise<unknown>;
    offset: number;
  }>({ view: null, answers: [], chain: Promise.resolve(), offset: 0 });
  const key = `slate:${me?.id}:exam:${id}`,
    eventsKey = `${key}:events`,
    autoSent = useRef(false);
  useEffect(() => {
    let active = true;
    if (!query.data || ref.current.view) return;
    void (async () => {
      const current = query.data!;
      let local: ExamAnswer[] | null = null;
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) local = JSON.parse(raw).answers;
      } catch {
        setError(
          new Error(
            "Saved device answers could not be read. Server answers remain available.",
          ),
        );
      }
      if (!active) return;
      const restored =
        current.status === "in_progress" && Array.isArray(local)
          ? local.filter((a) =>
              current.questions.some((q) => q.id === a.questionId),
            )
          : current.answers;
      ref.current.view = current;
      ref.current.answers = restored;
      ref.current.offset = Date.parse(current.serverNow) - Date.now();
      setView(current);
      setAnswers(restored);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [query.data, key]);
  const persist = useCallback(
    (next: ExamAnswer[]) =>
      AsyncStorage.setItem(
        key,
        JSON.stringify({
          answers: next,
          revision: ref.current.view?.revision,
          savedAt: new Date().toISOString(),
        }),
      ),
    [key],
  );
  const sync = useCallback(
    (finish = false): Promise<ExamAttemptView> => {
      const job = ref.current.chain
        .catch(() => {})
        .then(async () => {
          const current = ref.current.view;
          if (!current) throw new Error("Wait for the exam to load.");
          const pending = ref.current.answers;
          setSaving(true);
          try {
            const result = await api<ExamAttemptView>(
              `student/exam-attempts/${id}/${finish ? "submit" : "answers"}`,
              finish ? "POST" : "PUT",
              { revision: current.revision, answers: pending },
            );
            ref.current.view = result;
            setView(result);
            if (finish) await AsyncStorage.removeItem(key);
            return result;
          } finally {
            setSaving(false);
          }
        });
      ref.current.chain = job;
      return job;
    },
    [id, key],
  );
  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await sync(true);
    } catch (e) {
      setError(e as Error);
    } finally {
      setFinishing(false);
    }
  }, [finishing, sync]);
  const deadlineAt = view?.deadlineAt,
    attemptStatus = view?.status;
  useEffect(() => {
    if (!deadlineAt || attemptStatus !== "in_progress") return;
    const timer = setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil(
          (Date.parse(deadlineAt) - Date.now() - ref.current.offset) / 1000,
        ),
      );
      setRemaining(left);
      if (!left && !autoSent.current) {
        autoSent.current = true;
        void finish();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, attemptStatus, finish]);
  useEffect(() => {
    if (!ready || view?.status !== "in_progress") return;
    const timer = setTimeout(
      () => void sync().catch((e) => setError(e as Error)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [answers, ready, view?.status, sync]);
  useEffect(() => {
    if (
      !ready ||
      !view?.exam.monitoring.enabled ||
      view.status !== "in_progress"
    )
      return;
    let queue: Promise<unknown> = Promise.resolve();
    const add = (type: ExamMonitorEvent["type"]) => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          try {
            const raw = await AsyncStorage.getItem(eventsKey),
              list: ExamMonitorEvent[] = raw ? JSON.parse(raw) : [];
            list.push({
              id: randomUUID(),
              type,
              occurredAt: new Date().toISOString(),
            });
            await AsyncStorage.setItem(eventsKey, JSON.stringify(list));
            await api(`student/exam-attempts/${id}/events`, "POST", {
              events: list.slice(0, 50),
            });
            await AsyncStorage.setItem(
              eventsKey,
              JSON.stringify(list.slice(50)),
            );
          } catch {
            /* Pending events remain on this device for the next connection. */
          }
        });
      return queue;
    };
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void persist(ref.current.answers).catch(() => {});
        void add("window_blur");
      }
    });
    const network = Network.addNetworkStateListener((state) => {
      void add(state.isConnected === false ? "offline" : "online");
    });
    void add("online");
    return () => {
      app.remove();
      network.remove();
    };
  }, [
    id,
    ready,
    view?.status,
    view?.exam.monitoring.enabled,
    eventsKey,
    persist,
  ]);
  usePreventRemove(
    Boolean(view?.status === "in_progress" && !allowLeave),
    ({ repeat }) =>
      Alert.alert(
        "Leave the exam?",
        "The timer keeps running. Save your answers before leaving.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Save & leave",
            onPress: () =>
              void sync()
                .then(() => {
                  setAllowLeave(true);
                  repeat();
                })
                .catch((e) => setError(e as Error)),
          },
        ],
      ),
  );
  const update = (answer: ExamAnswer) => {
    const next = [
      ...ref.current.answers.filter((a) => a.questionId !== answer.questionId),
      answer,
    ];
    ref.current.answers = next;
    setAnswers(next);
    setError(null);
    void persist(next).catch((e) => setError(e as Error));
  };
  const q = view?.questions[index],
    answer = answers.find((a) => a.questionId === q?.id),
    answered = answers.filter(
      (a) =>
        (a.selectedOption !== undefined && a.selectedOption !== null) ||
        a.code?.trim(),
    ).length;
  if (view && view.status !== "in_progress")
    return (
      <Screen back title="Exam result">
        <Title>{view.exam.title}</Title>
        <Badge tone="teal">{view.status}</Badge>
        {view.result ? (
          <>
            <Label style={{ fontSize: 25, fontWeight: "700" }}>
              {view.result.percentage === null
                ? "Pending manual review"
                : `${view.result.percentage}%`}
            </Label>
            {view.result.questions.map((result) => (
              <Card key={result.questionId}>
                <Label style={{ fontWeight: "700" }}>{result.title}</Label>
                <Label>
                  {result.earnedPoints === null
                    ? "Pending review"
                    : `${result.earnedPoints}/${result.points} points`}
                </Label>
                <Label muted>{result.explanation || result.verdict}</Label>
              </Card>
            ))}
          </>
        ) : (
          <Notice>
            Your answers are submitted. Results appear after review and release
            by your administrator.
          </Notice>
        )}
        <Button
          title="Back to exams"
          onPress={() => router.replace("/exams")}
        />
      </Screen>
    );
  return (
    <Screen
      back
      title={view?.exam.title || "Exam"}
      scroll={false}
      style={{ flex: 1, paddingTop: 4 }}
    >
      <State
        pending={query.isPending || !ready}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {view && q && (
        <>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Badge tone={remaining < 120 ? "red" : "purple"}>
              {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </Badge>
            <Label muted>
              {index + 1}/{view.questions.length}
            </Label>
            <Button
              title="Questions"
              secondary
              onPress={() => setNavigator(true)}
            />
          </View>
          <Label muted>
            {saving
              ? "Saving answers…"
              : "Answers saved locally; syncing to your account"}
          </Label>
          {error && (
            <Notice error>
              {error.message} Your local answer text is retained. Retry saving
              before leaving.
            </Notice>
          )}
          {error && (
            <Button
              title="Retry save"
              secondary
              onPress={() => void sync().catch((e) => setError(e as Error))}
            />
          )}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 15, paddingBottom: 20 }}
          >
            {q.kind === "mcq" ? (
              <Choices
                question={q}
                value={answer?.selectedOption ?? undefined}
                onChange={(value) =>
                  update({ questionId: q.id, selectedOption: value })
                }
                imagePath={`student/exam-attempts/${id}/images/${q.image?.uploadId}`}
              />
            ) : (
              <>
                <Title>{q.title}</Title>
                <Label>{q.prompt}</Label>
                <Select
                  label="Language"
                  value={answer?.language || q.languages[0]}
                  options={q.languages.map((l) => ({ value: l, label: l }))}
                  onChange={(language) =>
                    Alert.alert(
                      "Change language?",
                      "This replaces the current code with this language’s starter.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Change",
                          onPress: () =>
                            update({
                              questionId: q.id,
                              language: language as ExamLanguage,
                              code:
                                q.starterCode[language as ExamLanguage] || "",
                            }),
                        },
                      ],
                    )
                  }
                />
                <CodeEditor
                  value={
                    answer?.code ??
                    q.starterCode[answer?.language || q.languages[0]] ??
                    ""
                  }
                  onChange={(code) =>
                    update({
                      questionId: q.id,
                      language: answer?.language || q.languages[0],
                      code,
                    })
                  }
                  editable={remaining > 0}
                />
                <Notice>
                  Your code is submitted for manual review. No automatic
                  execution.
                </Notice>
              </>
            )}
            <Button
              title={
                flags.includes(q.id) ? "Unflag question" : "Flag for review"
              }
              secondary
              onPress={() =>
                setFlags(
                  flags.includes(q.id)
                    ? flags.filter((v) => v !== q.id)
                    : [...flags, q.id],
                )
              }
            />
          </ScrollView>
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
              disabled={index === view.questions.length - 1}
              onPress={() => setIndex(index + 1)}
              style={{ flex: 1 }}
            />
          </View>
          <Button
            title="Finish exam"
            loading={finishing}
            onPress={() =>
              Alert.alert(
                "Submit exam?",
                `${answered} answered · ${view.questions.length - answered} unanswered. You cannot change answers after submitting.`,
                [
                  { text: "Return to exam", style: "cancel" },
                  { text: "Submit", onPress: () => void finish() },
                ],
              )
            }
          />
          <Modal
            visible={navigator}
            transparent
            animationType="slide"
            onRequestClose={() => setNavigator(false)}
          >
            <Pressable style={s.scrim} onPress={() => setNavigator(false)} />
            <View style={s.sheet}>
              <Title>Question navigator</Title>
              <Label muted>Teal: answered · Amber: flagged</Label>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                {view.questions.map((question, i) => (
                  <Button
                    key={question.id}
                    title={`${i + 1}${flags.includes(question.id) ? " ⚑" : ""}`}
                    secondary={
                      !answers.some((a) => a.questionId === question.id)
                    }
                    style={{ minWidth: 49 }}
                    onPress={() => {
                      setIndex(i);
                      setNavigator(false);
                    }}
                  />
                ))}
              </View>
              <Button
                title="Back to exam"
                onPress={() => setNavigator(false)}
              />
            </View>
          </Modal>
        </>
      )}
    </Screen>
  );
}

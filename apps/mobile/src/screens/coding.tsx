import { useEffect, useState, useRef, useMemo } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { PracticeAssessment } from "@slate/contracts";
import * as WebBrowser from "expo-web-browser";
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
} from "../components/ui";
import { EmptyFeature } from "../components/learning";
import { ProgressRing } from "../components/progress-ring";
import { CodeEditor } from "../components/code-editor";
import { usePage, useFeature, useSession } from "../lib/session";
import { useCodingProgress } from "../lib/coding-progress";
import { colors } from "../theme";
export function CodingScreen() {
  const allowed = useFeature("practice"),
    { me } = useSession(),
    query = usePage<PracticeAssessment[]>("student/practice", allowed),
    progress = useCodingProgress();
  const [dark, setDark] = useState(true),
    [expanded, setExpanded] = useState(true),
    [search, setSearch] = useState(""),
    [difficulty, setDifficulty] = useState("All"),
    [topic, setTopic] = useState("all");
  const coding = (query.data || []).filter((p) => p.kind === "coding"),
    rows = useMemo(
      () =>
        coding.filter(
          (p) =>
            p.title.toLowerCase().includes(search.toLowerCase()) &&
            (difficulty === "All" || p.difficulty === difficulty) &&
            (topic === "all" || p.topics?.includes(topic)),
        ),
      [coding, search, difficulty, topic],
    );
  const options = [...new Set(coding.flatMap((p) => p.topics || []))];
  return (
    <Screen
      title="Coding"
      scroll={false}
      style={{
        flex: 1,
        backgroundColor: dark ? colors.dark : colors.background,
        paddingTop: 4,
      }}
      actions={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dark ? "Use light theme" : "Use dark theme"}
          onPress={() => setDark(!dark)}
          style={s.iconButton}
        >
          <Icon name={dark ? "sun" : "moon"} />
        </Pressable>
      }
    >
      {!allowed ||
      !me?.access?.practiceModuleIds.includes("competitive-coding") ? (
        <EmptyFeature />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 10, paddingBottom: 30 }}
          ListHeaderComponent={
            <View style={{ gap: 15, paddingBottom: 15 }}>
              <Text
                style={{
                  fontSize: 28,
                  fontWeight: "700",
                  color: dark ? "#fff" : colors.text,
                }}
              >
                Build your coding confidence.
              </Text>
              <Card
                style={{
                  backgroundColor: dark ? colors.darkCard : "#fff",
                  borderColor: dark ? "#494949" : colors.line,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExpanded(!expanded)}
                  style={[s.row, { justifyContent: "space-between" }]}
                >
                  <Label
                    style={{
                      fontWeight: "700",
                      color: dark ? "#fff" : colors.text,
                    }}
                  >
                    Your daily progress
                  </Label>
                  <Icon
                    name={expanded ? "chevron-up" : "chevron-down"}
                    color={dark ? "#ddd" : colors.primary}
                  />
                </Pressable>
                {expanded && (
                  <>
                    <View style={[s.row, { justifyContent: "space-around" }]}>
                      <ProgressRing
                        dark={dark}
                        value={progress.data?.solved.length || 0}
                        total={coding.length}
                        label="Solved"
                      />
                      <View style={{ gap: 12 }}>
                        {["Easy", "Medium", "Hard"].map((d, i) => (
                          <View key={d}>
                            <Label
                              style={{
                                color: [colors.teal, "#D9AB5C", "#E8A0AD"][i],
                                fontWeight: "700",
                              }}
                            >
                              {d}
                            </Label>
                            <Label
                              style={{ color: dark ? "#fff" : colors.text }}
                            >
                              {
                                coding.filter(
                                  (p) =>
                                    p.difficulty === d &&
                                    progress.data?.solved.includes(p.id),
                                ).length
                              }
                              /{coding.filter((p) => p.difficulty === d).length}
                            </Label>
                          </View>
                        ))}
                      </View>
                    </View>
                    <Button
                      title={
                        coding.length
                          ? "Open today’s challenge"
                          : "Loading challenges…"
                      }
                      disabled={!coding.length}
                      onPress={() =>
                        coding.length &&
                        router.push(
                          `/coding/${coding[Math.floor(Date.now() / 86400000) % coding.length].id}`,
                        )
                      }
                    />
                  </>
                )}
              </Card>
              <Field
                dark={dark}
                label="Find a problem"
                placeholder="Search coding questions"
                value={search}
                onChangeText={setSearch}
              />
              <Chips
                value={difficulty}
                onChange={setDifficulty}
                items={["All", "Easy", "Medium", "Hard"].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              <Select
                dark={dark}
                label="Topic"
                value={topic}
                onChange={setTopic}
                options={[
                  { value: "all", label: "All topics" },
                  ...options.map((t) => ({ value: t, label: t })),
                ]}
              />
              <State
                pending={query.isPending}
                error={query.error || progress.error}
                onRetry={() => void query.refetch()}
              />
            </View>
          }
          renderItem={({ item }) => (
            <Card
              onPress={() => router.push(`/coding/${item.id}`)}
              style={[
                s.row,
                {
                  backgroundColor: dark ? colors.darkCard : "#fff",
                  borderColor: dark ? "#454545" : colors.line,
                },
              ]}
            >
              <Label
                style={{ color: dark ? "#aaa" : colors.muted, fontSize: 12 }}
              >
                {item.number}
              </Label>
              <View style={{ flex: 1, gap: 6 }}>
                <Label
                  style={{
                    fontWeight: "600",
                    color: dark ? "#fff" : colors.text,
                  }}
                >
                  {item.title}
                </Label>
                <Badge
                  tone={
                    item.difficulty === "Easy"
                      ? "teal"
                      : item.difficulty === "Medium"
                        ? "amber"
                        : "red"
                  }
                >
                  {item.difficulty}
                </Badge>
              </View>
              <Icon
                name={
                  progress.data?.solved.includes(item.id)
                    ? "check-circle"
                    : "chevron-right"
                }
                color={
                  progress.data?.solved.includes(item.id)
                    ? "#65C8A4"
                    : "#9DADBD"
                }
              />
            </Card>
          )}
          ListEmptyComponent={
            !query.isPending && !query.error ? (
              <Label muted>No matching problems.</Label>
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}
export function CodingProblemScreen() {
  const params = useLocalSearchParams<{
    id: string;
    courseId: string;
    lessonId: string;
    sessionId?: string;
  }>();
  return <CodingProblemContent key={params.id} />;
}
function CodingProblemContent() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<PracticeAssessment[]>("student/practice"),
    progress = useCodingProgress(),
    problem = query.data?.find((p) => p.id === id);
  const [tab, setTab] = useState("problem"),
    [language, setLanguage] = useState("Python"),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState<Error | null>(null),
    loaded = useRef("");
  useEffect(() => {
    if (!problem || !progress.data || loaded.current === id) return;
    const draft = progress.data.drafts[id];
    setLanguage(
      draft?.language ||
        Object.keys(problem.problem?.starterCode || {})[0] ||
        "Python",
    );
    setCode(
      draft?.code || Object.values(problem.problem?.starterCode || {})[0] || "",
    );
    loaded.current = id;
  }, [id, problem, progress.data]);
  const save = async () => {
    try {
      await progress.update((current) => ({
        ...current,
        drafts: { ...current.drafts, [id]: { language, code } },
        attempting: current.attempting.includes(id)
          ? current.attempting
          : [...current.attempting, id],
      }));
      setNotice("Draft saved on this device.");
    } catch (e) {
      setError(e as Error);
    }
  };
  const mark = async () => {
    try {
      await save();
      await progress.update((current) => ({
        ...current,
        solved: current.solved.includes(id)
          ? current.solved
          : [...current.solved, id],
        attempting: current.attempting.filter((v) => v !== id),
      }));
      setNotice("Marked solved in your progress.");
    } catch (e) {
      setError(e as Error);
    }
  };
  return (
    <Screen back title={problem?.title || "Coding problem"}>
      <State
        pending={query.isPending || progress.isPending}
        error={query.error || progress.error || error}
        onRetry={() => void query.refetch()}
      />
      {problem && (
        <>
          <Badge
            tone={
              problem.difficulty === "Easy"
                ? "teal"
                : problem.difficulty === "Medium"
                  ? "amber"
                  : "red"
            }
          >
            {problem.difficulty}
          </Badge>
          <Chips
            value={tab}
            onChange={setTab}
            items={[
              { value: "problem", label: "Problem" },
              { value: "code", label: "Code" },
            ]}
          />
          {tab === "problem" ? (
            <>
              <Title>{problem.title}</Title>
              <Label>{problem.problem?.statement || problem.description}</Label>
              {problem.problem?.examples.map((example, index) => (
                <Card key={index}>
                  <Label style={{ fontWeight: "700" }}>
                    Example {index + 1}
                  </Label>
                  <Label>Input: {example.input}</Label>
                  <Label>Output: {example.output}</Label>
                  <Label muted>{example.explanation}</Label>
                </Card>
              ))}
              <Card>
                <Label style={{ fontWeight: "700" }}>Constraints</Label>
                {problem.problem?.constraints.map((c, i) => (
                  <Label key={i}>• {c}</Label>
                ))}
              </Card>
              <Button title="Write solution" onPress={() => setTab("code")} />
            </>
          ) : (
            <>
              <Select
                label="Language"
                value={language}
                options={Object.keys(problem.problem?.starterCode || {}).map(
                  (v) => ({ value: v, label: v }),
                )}
                onChange={(value) => {
                  void save();
                  setLanguage(value);
                  setCode(problem.problem?.starterCode[value] || "");
                }}
              />
              <CodeEditor
                value={code}
                onChange={setCode}
                editable={!progress.isPending}
              />
              <Notice>
                Use the compiler separately to run code. Coding-library progress
                is tracked by you; this screen does not automatically grade
                solutions.
              </Notice>
              <Button
                title="Save draft"
                disabled={!code.trim()}
                onPress={() => void save()}
              />
              <Button
                title="Mark solved"
                secondary
                disabled={!code.trim()}
                onPress={() => void mark()}
              />
            </>
          )}
          {notice && <Notice>{notice}</Notice>}
        </>
      )}
    </Screen>
  );
}
export function CompilerScreen() {
  const allowed = useFeature("compiler"),
    [language, setLanguage] = useState("python"),
    [error, setError] = useState<Error | null>(null);
  const enabled = usePage("student/compiler", allowed);
  return (
    <Screen back title="Online compiler">
      <Title>Write. Run. Explore.</Title>
      <Label muted>
        Open OneCompiler in your browser to run code in your preferred language.
      </Label>
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Select
            label="Language"
            value={language}
            onChange={setLanguage}
            options={[
              "python",
              "c",
              "cpp",
              "java",
              "javascript",
              "typescript",
              "go",
              "rust",
              "csharp",
              "kotlin",
            ].map((v) => ({ value: v, label: v.toUpperCase() }))}
          />
          <State
            pending={enabled.isPending}
            error={enabled.error || error}
            onRetry={() => void enabled.refetch()}
          />
          <Button
            title="Open OneCompiler"
            icon="external-link"
            disabled={!enabled.data}
            onPress={() =>
              void WebBrowser.openBrowserAsync(
                `https://onecompiler.com/${language}`,
              ).catch(setError)
            }
          />
          <Label muted>Powered by OneCompiler</Label>
        </>
      )}
    </Screen>
  );
}

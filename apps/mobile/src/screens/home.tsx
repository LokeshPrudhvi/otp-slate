import { useState } from "react";
import { View, Alert } from "react-native";
import { router } from "expo-router";
import type {
  Course,
  CrtStudentTopic,
  StudentExamSummary,
  Ranking,
} from "@slate/contracts";
import { crtSubjects } from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Card,
  Button,
  State,
  Chips,
  Icon,
  IconButton,
  Notice,
  s,
  type IconName,
} from "../components/ui";
import { ProgressRing } from "../components/progress-ring";
import { CourseArtwork } from "../components/learning";
import { usePage, useSession, useFeature } from "../lib/session";
import { useCodingProgress } from "../lib/coding-progress";
import { colors } from "../theme";
export function Rankings({ full = false }: { full?: boolean }) {
  const hasRankings = useFeature("rankings"),
    hasCrt = useFeature("crt"),
    allowed = hasRankings && hasCrt,
    [mode, setMode] = useState("overall"),
    [visible, setVisible] = useState(true),
    query = usePage<Ranking[]>(
      `student/rankings?kind=crt&mode=${mode}`,
      allowed && visible,
    );
  if (!allowed) return null;
  return (
    <Card>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Label style={{ fontSize: 20, fontWeight: "700" }}>CRT – Ranking</Label>
        <IconButton
          name={visible ? "eye" : "eye-off"}
          label={visible ? "Hide rankings" : "Show rankings"}
          onPress={() => setVisible(!visible)}
        />
      </View>
      {visible && (
        <>
          <Chips
            value={mode}
            onChange={setMode}
            items={[
              { value: "latest", label: "Latest" },
              { value: "overall", label: "Overall" },
            ]}
          />
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          {query.data
            ?.slice(0, full ? query.data.length : 5)
            .map((row, index) => (
              <View
                key={row.id}
                style={[
                  s.row,
                  {
                    paddingVertical: 9,
                    borderBottomWidth: 1,
                    borderColor: colors.line,
                  },
                ]}
              >
                <Label
                  style={{
                    fontWeight: "700",
                    width: 28,
                    color: index < 3 ? colors.amber : colors.muted,
                  }}
                >
                  {row.rank ?? "–"}
                </Label>
                <Label style={{ flex: 1 }}>{row.name}</Label>
                <Label muted>
                  {row.points === undefined
                    ? "Not attempted"
                    : `${row.points}%`}
                </Label>
              </View>
            ))}
          {!full && (
            <Button
              title="View all rankings"
              secondary
              onPress={() => router.push("/rankings")}
            />
          )}
        </>
      )}
    </Card>
  );
}
export function HomeScreen() {
  const { me } = useSession(),
    courses = usePage<Course[]>("student/courses", useFeature("courses")),
    crt = usePage<CrtStudentTopic[]>("student/crt/topics", useFeature("crt")),
    exams = usePage<StudentExamSummary[]>(
      "student/exams",
      useFeature("live-exams"),
    ),
    coding = useCodingProgress();
  const complete = crtSubjects.filter((subject) => {
    const rows = crt.data?.filter((t) => t.subjectId === subject.id);
    return rows?.length && rows.every((t) => t.completed);
  }).length;
  const live = exams.data?.filter((e) => e.state === "live"),
    inbox = useFeature("inbox");
  return (
    <Screen
      actions={
        inbox ? (
          <IconButton
            name="mail"
            label="Open inbox"
            onPress={() => router.push("/inbox")}
          />
        ) : undefined
      }
      onRefresh={() => {
        void courses.refetch();
        void crt.refetch();
        void exams.refetch();
      }}
    >
      <Title>
        Good to see you,{`\n`}
        {me?.name.split(" ")[0]}.
      </Title>
      <Label muted>
        {me?.access?.display.welcomeText || "Small steps. Lasting progress."}
      </Label>
      <View style={[s.row, { alignItems: "stretch" }]}>
        {me?.features.includes("crt") && (
          <Card style={{ flex: 1, padding: 12, alignItems: "center" }}>
            <Label style={{ fontWeight: "700" }}>CRT</Label>
            <ProgressRing value={complete} total={4} label="Modules" />
          </Card>
        )}
        {me?.features.includes("practice") && (
          <Card style={{ flex: 1, padding: 12, alignItems: "center" }}>
            <Label style={{ fontWeight: "700" }}>Programming</Label>
            <ProgressRing
              value={coding.data?.solved.length || 0}
              total={600}
              label="Solved"
              color={colors.purple}
            />
          </Card>
        )}
      </View>
      {live?.map((exam) => (
        <Card key={exam.id} style={{ backgroundColor: colors.purpleLight }}>
          <Label style={{ color: colors.purple, fontWeight: "700" }}>
            LIVE NOW
          </Label>
          <Title>{exam.title}</Title>
          <Label muted>
            {exam.durationMinutes} minutes · {exam.questionCount} questions
          </Label>
          <Button
            title={exam.attemptId ? "Resume exam" : "View live exam"}
            onPress={() => router.push(`/exams/${exam.id}`)}
          />
        </Card>
      ))}
      {me?.features.includes("courses") && (
        <>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Title>Continue learning</Title>
            <IconButton
              name="arrow-right"
              label="All courses"
              onPress={() => router.push("/courses")}
            />
          </View>
          <State
            pending={courses.isPending}
            error={courses.error}
            onRetry={() => void courses.refetch()}
            empty={
              courses.data && !courses.data.length
                ? "No enrolled courses"
                : undefined
            }
          />
          {courses.data?.map((course) => (
            <Card
              key={course.id}
              onPress={() => router.push(`/courses/${course.id}`)}
            >
              <CourseArtwork title={course.title} url={course.coverImageUrl} />
              <Label style={{ fontSize: 19, fontWeight: "700" }}>
                {course.title}
              </Label>
              <Label muted>
                {course.lastOpenedAt
                  ? "Continue where you left off"
                  : "Open your course"}{" "}
                →
              </Label>
            </Card>
          ))}
        </>
      )}
      <Rankings />
    </Screen>
  );
}
const learning: {
  title: string;
  description: string;
  feature: string;
  route: string;
  icon: IconName;
  background: string;
  color: string;
}[] = [
  {
    title: "Courses",
    description: "Your next skill starts here.",
    feature: "courses",
    route: "/courses",
    icon: "book-open",
    background: colors.primaryLight,
    color: colors.primary,
  },
  {
    title: "CRT",
    description: "Build your placement confidence.",
    feature: "crt",
    route: "/crt",
    icon: "bar-chart-2",
    background: colors.tealLight,
    color: colors.teal,
  },
  {
    title: "Company PYQ",
    description: "Prepare for your target company.",
    feature: "pyq",
    route: "/pyq",
    icon: "layers",
    background: colors.purpleLight,
    color: colors.purple,
  },
  {
    title: "Live exams",
    description: "Upcoming tests and your results.",
    feature: "live-exams",
    route: "/exams",
    icon: "calendar",
    background: colors.amberLight,
    color: colors.amber,
  },
];
export function LearnScreen() {
  const { me } = useSession();
  return (
    <Screen>
      <Title>Learn at your pace.</Title>
      <Label muted>
        Choose a course, build your aptitude or prepare for an exam.
      </Label>
      {learning
        .filter((item) => me?.features.includes(item.feature))
        .map((item) => (
          <Card
            key={item.title}
            onPress={() => router.push(item.route as never)}
            style={{ backgroundColor: item.background, paddingVertical: 26 }}
          >
            <Icon name={item.icon} color={item.color} size={35} />
            <Label style={{ fontSize: 23, fontWeight: "700" }}>
              {item.title}
            </Label>
            <Label muted>{item.description}</Label>
            <View style={{ alignSelf: "flex-end" }}>
              <Icon name="arrow-up-right" color={item.color} />
            </View>
          </Card>
        ))}
    </Screen>
  );
}
export function MoreScreen() {
  const { me } = useSession();
  const items: [string, IconName, string, string?][] = [
    ["Account & help", "user", "/account"],
    ["Inbox", "mail", "/inbox", "inbox"],
    ["Announcements", "bell", "/announcements", "announcements"],
    ["Company PYQ", "layers", "/pyq", "pyq"],
    ["Online compiler", "terminal", "/compiler", "compiler"],
    ["CRT rankings", "bar-chart-2", "/rankings", "rankings"],
  ];
  return (
    <Screen>
      <Card>
        <Icon name="user" size={35} />
        <Title>{me?.name}</Title>
        <Label muted>{me?.organizationName}</Label>
        <Label muted>{me?.email}</Label>
      </Card>
      {items
        .filter(([, , , feature]) => !feature || me?.features.includes(feature))
        .map(([title, icon, route]) => (
          <Card
            key={title}
            onPress={() => router.push(route as never)}
            style={s.row}
          >
            <Icon name={icon} />
            <Label style={{ flex: 1, fontWeight: "600" }}>{title}</Label>
            <Icon name="chevron-right" />
          </Card>
        ))}
    </Screen>
  );
}
export function AccountScreen() {
  const { me, signOut } = useSession(),
    [error, setError] = useState<Error | null>(null);
  return (
    <Screen back title="Account & help">
      <Title>Your account</Title>
      <Card>
        <Label muted>Full name</Label>
        <Label>{me?.name}</Label>
        <Label muted>Email</Label>
        <Label>{me?.email}</Label>
        <Label muted>Organization</Label>
        <Label>{me?.organizationName}</Label>
      </Card>
      <Notice>
        Contact your organization’s administrator to correct student details or
        change your assigned learning.
      </Notice>
      <Button
        title="Reset password"
        secondary
        onPress={() => router.push("/reset-password")}
      />
      <Card>
        <Label style={{ fontWeight: "700" }}>Need a hand?</Label>
        <Label muted>
          Missing a course? Request access from the course catalogue. A
          registration awaiting approval is reviewed by Platform Admin. Exam
          results may wait for manual review or scheduled release.
        </Label>
        {me?.features.includes("inbox") && (
          <Button
            title="Message someone in your organization"
            secondary
            onPress={() => router.push("/compose")}
          />
        )}
      </Card>
      {error && <Notice error>{error.message}</Notice>}
      <Button
        title="Sign out"
        danger
        secondary
        onPress={() =>
          Alert.alert(
            "Sign out?",
            "Your saved account data stays in your organization. Unsent edits may be lost.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: () =>
                  void signOut()
                    .then(() => router.replace("/login"))
                    .catch(setError),
              },
            ],
          )
        }
      />
    </Screen>
  );
}
export function RankingsScreen() {
  return (
    <Screen back title="CRT rankings">
      <Rankings full />
    </Screen>
  );
}

import { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Course,
  CourseCatalogItem,
  LessonFile,
  LessonSubmission,
} from "@slate/contracts";
import Markdown from "react-native-markdown-display";
import { useVideoPlayer, VideoView } from "expo-video";
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
  s,
} from "../components/ui";
import { Choices, CourseArtwork, EmptyFeature } from "../components/learning";
import { usePage, useFeature } from "../lib/session";
import { api, safeExternalUrl } from "../lib/api";
import { pickAssignmentFile } from "../lib/files";
import { colors } from "../theme";
export type CourseDetail = Course & {
  lessons: NonNullable<Course["lessons"]>;
  completedLessonIds: string[];
};
export function CoursesScreen() {
  const allowed = useFeature("courses"),
    query = usePage<CourseCatalogItem[]>("student/course-catalog", allowed);
  const [tab, setTab] = useState("all"),
    [search, setSearch] = useState("");
  const request = useMutation({
    mutationFn: (id: string) =>
      api(`student/courses/${id}/enrollment-requests`, "POST", {}),
    onSuccess: () => query.refetch(),
  });
  const rows = (query.data || []).filter(
    (c) =>
      (tab === "all" || c.enrolled) &&
      c.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Screen back title="Courses">
      <Title>Learn something that moves you forward.</Title>
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Chips
            value={tab}
            onChange={setTab}
            items={[
              { value: "all", label: "All courses" },
              { value: "enrolled", label: "Enrolled" },
            ]}
          />
          <Field
            label="Find a course"
            placeholder="Search courses"
            value={search}
            onChangeText={setSearch}
          />
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
            empty={
              !query.isPending && !query.error && !rows.length
                ? "No matching courses"
                : undefined
            }
          />
          {request.error && <Notice error>{request.error.message}</Notice>}
          {rows.map((course) => (
            <Card key={course.id}>
              <CourseArtwork title={course.title} url={course.coverImageUrl} />
              <Badge tone={course.enrolled ? "teal" : "purple"}>
                {course.enrolled ? "Enrolled" : "Available on request"}
              </Badge>
              <Label style={{ fontSize: 19, fontWeight: "700" }}>
                {course.title}
              </Label>
              <Label muted>{course.description}</Label>
              <Button
                title={
                  course.enrolled
                    ? "Open course"
                    : course.enrollmentRequestStatus
                      ? "Request received"
                      : "Request access"
                }
                loading={request.isPending && request.variables === course.id}
                disabled={
                  !course.enrolled && Boolean(course.enrollmentRequestStatus)
                }
                secondary={!course.enrolled}
                onPress={() =>
                  course.enrolled
                    ? router.push(`/courses/${course.id}`)
                    : request.mutate(course.id)
                }
              />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
export function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<CourseDetail>(`student/courses/${id}`);
  useEffect(() => {
    void api(`student/courses/${id}/opened`, "POST", {}).catch(() => {});
  }, [id]);
  const course = query.data;
  return (
    <Screen back title="Course">
      <State
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {course && (
        <>
          <CourseArtwork title={course.title} url={course.coverImageUrl} />
          <Title>{course.title}</Title>
          <Label muted>{course.description}</Label>
          <Label>
            {course.completedLessonIds.length} of {course.lessons.length}{" "}
            lessons completed
          </Label>
          <Button
            title="Continue learning"
            onPress={() => {
              const lesson =
                course.lessons.find(
                  (l) => !course.completedLessonIds.includes(l.id),
                ) || course.lessons[0];
              if (lesson) router.push(`/lessons/${id}/${lesson.id}`);
            }}
          />
          <Title>Course syllabus</Title>
          {course.lessons.map((lesson, index) => (
            <Card
              key={lesson.id}
              onPress={() => router.push(`/lessons/${id}/${lesson.id}`)}
              style={s.row}
            >
              <Icon
                name={
                  course.completedLessonIds.includes(lesson.id)
                    ? "check-circle"
                    : lesson.kind === "video"
                      ? "play-circle"
                      : lesson.kind === "quiz"
                        ? "check-square"
                        : "file-text"
                }
                color={
                  course.completedLessonIds.includes(lesson.id)
                    ? colors.teal
                    : colors.primary
                }
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Label style={{ fontWeight: "600" }}>{lesson.title}</Label>
                <Label muted style={{ fontSize: 12 }}>
                  {index + 1} · {lesson.kind || "Reading"}
                </Label>
              </View>
              <Icon name="chevron-right" size={18} />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
function NativeVideo({ source }: { source: string }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ height: 230, width: "100%", borderRadius: 10 }}
      nativeControls
      fullscreenOptions={{ enable: true }}
    />
  );
}
export function LessonScreen() {
  const params = useLocalSearchParams<{
    id: string;
    courseId: string;
    lessonId: string;
    sessionId?: string;
  }>();
  return <LessonContent key={`${params.courseId}:${params.lessonId}`} />;
}
function LessonContent() {
  const { courseId, lessonId } = useLocalSearchParams<{
    courseId: string;
    lessonId: string;
  }>();
  const query = usePage<CourseDetail>(`student/courses/${courseId}`),
    course = query.data,
    lesson = course?.lessons.find((l) => l.id === lessonId);
  const video = usePage<{ url: string; kind?: string }>(
    `student/courses/${courseId}/lessons/${lessonId}/video`,
    lesson?.kind === "video",
  );
  const submission = usePage<LessonSubmission | null>(
    `student/courses/${courseId}/lessons/${lessonId}/submission`,
    Boolean(lesson && ["assignment", "quiz"].includes(lesson.kind || "")),
  );
  const [answer, setAnswer] = useState(""),
    [link, setLink] = useState(""),
    [files, setFiles] = useState<LessonFile[]>([]),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [notice, setNotice] = useState("");
  const client = useQueryClient();
  const upload = useMutation({
    mutationFn: () => pickAssignmentFile(courseId, lessonId),
    onSuccess: (file) => {
      if (file) setFiles((current) => [...current, file]);
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      api<LessonSubmission>(
        `student/courses/${courseId}/lessons/${lessonId}/submission`,
        "POST",
        {
          versionId: course?.versionId,
          ...(lesson?.kind === "quiz"
            ? { answers }
            : {
                answer: answer || undefined,
                url: link || undefined,
                uploadIds: files.map((f) => f.id),
              }),
        },
      ),
    onSuccess: () => {
      setNotice("Submission saved. Coding assignments are reviewed manually.");
      void submission.refetch();
      void query.refetch();
    },
  });
  const complete = useMutation({
    mutationFn: () =>
      api(
        `student/courses/${courseId}/lessons/${lessonId}/complete`,
        "POST",
        {},
      ),
    onSuccess: () => {
      setNotice("Lesson complete");
      void query.refetch();
      void client.invalidateQueries({
        queryKey: ["native", "student/courses"],
      });
    },
  });
  const error = query.error || submit.error || complete.error || upload.error;
  const index = course?.lessons.findIndex((l) => l.id === lessonId) ?? -1,
    next = course?.lessons[index + 1];
  return (
    <Screen back title={lesson?.title || "Lesson"}>
      <State
        pending={query.isPending}
        error={error}
        onRetry={() => void query.refetch()}
      />
      {lesson && (
        <>
          <Label muted>
            Lesson {index + 1} of {course?.lessons.length}
          </Label>
          {lesson.kind === "video" && (
            <>
              <State
                pending={video.isPending}
                error={video.error}
                onRetry={() => void video.refetch()}
              />
              {video.data &&
                (video.data.kind === "file" ||
                /\.(mp4|webm|m3u8)(\?|$)/i.test(video.data.url) ? (
                  <NativeVideo source={video.data.url} />
                ) : (
                  <Button
                    title="Watch with video provider"
                    icon="external-link"
                    onPress={() =>
                      void WebBrowser.openBrowserAsync(
                        safeExternalUrl(lesson.video?.url || video.data!.url),
                      )
                    }
                  />
                ))}
            </>
          )}
          <Markdown
            onLinkPress={(url) => {
              void WebBrowser.openBrowserAsync(safeExternalUrl(url));
              return false;
            }}
            style={{
              body: { color: colors.text, fontSize: 15, lineHeight: 24 },
              heading1: { fontSize: 25 },
              code_block: {
                backgroundColor: colors.primaryLight,
                borderColor: colors.line,
                fontSize: 13,
              },
              fence: {
                backgroundColor: colors.primaryLight,
                borderColor: colors.line,
                fontSize: 13,
              },
            }}
          >
            {lesson.body}
          </Markdown>
          {lesson.kind === "assignment" && (
            <Card>
              <Title>Your submission</Title>
              {lesson.assignment?.acceptText && (
                <Field
                  label="Written answer / source code"
                  multiline
                  value={answer}
                  onChangeText={setAnswer}
                  maxLength={50000}
                />
              )}{" "}
              {lesson.assignment?.acceptLink && (
                <Field
                  label="Project / repository URL"
                  value={link}
                  onChangeText={setLink}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              )}
              {files.map((file) => (
                <Pressable
                  key={file.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${file.fileName}`}
                  onPress={() =>
                    setFiles(files.filter((f) => f.id !== file.id))
                  }
                >
                  <Label>{file.fileName} · Remove ×</Label>
                </Pressable>
              ))}
              {lesson.assignment?.acceptFiles && (
                <Button
                  title="Attach a file"
                  secondary
                  icon="paperclip"
                  loading={upload.isPending}
                  disabled={files.length >= 3}
                  onPress={() => upload.mutate()}
                />
              )}
              <Button
                title="Submit assignment"
                loading={submit.isPending}
                disabled={
                  upload.isPending ||
                  (!answer.trim() && !link.trim() && !files.length)
                }
                onPress={() => submit.mutate()}
              />
            </Card>
          )}
          {lesson.kind === "quiz" &&
            lesson.quiz?.questions.map((q, i) => (
              <Card key={q.id}>
                <Label muted>Question {i + 1}</Label>
                <Choices
                  question={q}
                  value={answers[q.id]}
                  onChange={(value) =>
                    setAnswers({ ...answers, [q.id]: value })
                  }
                  imagePath={`student/courses/${courseId}/lessons/${lessonId}/images/${q.image?.uploadId}`}
                />
              </Card>
            ))}
          {lesson.kind === "quiz" && (
            <Button
              title="Submit answers"
              loading={submit.isPending}
              disabled={
                Object.keys(answers).length !==
                (lesson.quiz?.questions.length || 0)
              }
              onPress={() => submit.mutate()}
            />
          )}{" "}
          {submission.data && (
            <Notice>
              {submission.data.kind === "quiz"
                ? `Score: ${submission.data.score}% · ${submission.data.passed ? "Passed" : "Review the lesson and try again"}`
                : "Your assignment is submitted."}
            </Notice>
          )}
          {notice && <Notice>{notice}</Notice>}
          {["text", "video"].includes(lesson.kind || "text") && (
            <Button
              title={
                course?.completedLessonIds.includes(lesson.id)
                  ? "Completed"
                  : "Mark complete"
              }
              loading={complete.isPending}
              disabled={course?.completedLessonIds.includes(lesson.id)}
              onPress={() => complete.mutate()}
            />
          )}{" "}
          {next && (
            <Button
              title="Next lesson"
              secondary
              onPress={() => router.replace(`/lessons/${courseId}/${next.id}`)}
            />
          )}
        </>
      )}
    </Screen>
  );
}

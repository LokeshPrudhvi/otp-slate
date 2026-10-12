import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Lesson, LessonFile, LessonSubmission } from "@slate/contracts";
import { getLessonVideoSource } from "@slate/contracts";
import { api, LessonContent, uploadLessonFile } from "@slate/ui";
import { useStudentData } from "./access";
import { Status, StudentIcon } from "./design";

export const lessonPresentation = {
  text: {
    label: "Reading",
    icon: "page",
    description: "Read the lesson, then mark it complete when you are ready.",
  },
  video: {
    label: "Video",
    icon: "video",
    description: "Watch the video and explore the accompanying lesson notes.",
  },
  assignment: {
    label: "Assignment",
    icon: "assign",
    description:
      "Follow the instructions and submit your work to complete this activity.",
  },
  quiz: {
    label: "Quiz",
    icon: "practice",
    description: "Check your understanding with a multiple-choice assignment.",
  },
} as const;

type ActivityProps = {
  courseId: string;
  versionId?: string;
  lesson: Lesson;
  done: boolean;
};

function activityPath(courseId: string, lessonId: string) {
  return `student/courses/${courseId}/lessons/${lessonId}`;
}

function useRefreshProgress(courseId: string) {
  const query = useQueryClient();
  return () => {
    void query.invalidateQueries({
      queryKey: ["student", `course-${courseId}`],
    });
    void query.invalidateQueries({ queryKey: ["student", "courses"] });
    void query.invalidateQueries({ queryKey: ["me", "student"] });
  };
}

function LessonVideo({
  courseId,
  lesson,
}: {
  courseId: string;
  lesson: Lesson;
}) {
  const uploaded = Boolean(lesson.video?.uploadId);
  const source = useStudentData<{ url: string; expiresIn: number }>(
    `lesson-video-${courseId}-${lesson.id}-${lesson.video?.uploadId}`,
    `${activityPath(courseId, lesson.id)}/video`,
    uploaded,
  );
  const [playbackError, setPlaybackError] = useState(false);
  const external = lesson.video?.url
    ? getLessonVideoSource(lesson.video.url)
    : null;
  const video = uploaded
    ? source.data
      ? { kind: "file", url: source.data.url }
      : null
    : external;
  return (
    <div className="lesson-video-section">
      {uploaded && <Status pending={source.isPending} error={source.error} />}
      {video && (
        <div className="lesson-video-player">
          {video.kind === "file" ? (
            <video
              key={video.url}
              controls
              preload="metadata"
              playsInline
              aria-label={lesson.title}
              onError={() => setPlaybackError(true)}
              onLoadedData={() => setPlaybackError(false)}
            >
              <source src={video.url} />
              Your browser does not support video playback.
            </video>
          ) : (
            <iframe
              src={video.url}
              title={lesson.title}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      )}
      {!uploaded && !video && (
        <p className="lesson-notice" role="status">
          This video is not available. Please contact your organization.
        </p>
      )}
      {(playbackError || (uploaded && source.error)) && (
        <div className="lesson-notice" role="status">
          <p>The video could not load. Check your connection and try again.</p>
          {uploaded && (
            <button
              className="a-btn"
              disabled={source.isFetching}
              onClick={() => {
                setPlaybackError(false);
                void source.refetch();
              }}
            >
              {source.isFetching ? "Refreshing video…" : "Refresh video"}
            </button>
          )}
        </div>
      )}
      {lesson.video?.url && external && (
        <a
          className="lesson-video-link"
          href={lesson.video.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open video in a new tab ↗
        </a>
      )}
    </div>
  );
}

function FileDownload({ file }: { file: LessonFile }) {
  const download = useMutation({
    mutationFn: () =>
      api<{ url: string; expiresIn: number }>(
        `lesson-uploads/${file.id}/download`,
      ),
  });
  return (
    <span className="lesson-file-download">
      {download.data ? (
        <a href={download.data.url} target="_blank" rel="noopener noreferrer">
          Download {file.fileName} ↗
        </a>
      ) : (
        <button
          className="lesson-link-button"
          type="button"
          onClick={() => download.mutate()}
          disabled={download.isPending}
        >
          {download.isPending
            ? "Preparing download…"
            : `Download ${file.fileName}`}
        </button>
      )}
      <Status error={download.error} />
    </span>
  );
}

function formatFileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function AssignmentForm({
  courseId,
  versionId,
  lesson,
  submission,
  onSaved,
}: ActivityProps & {
  submission: LessonSubmission | null;
  onSaved: (submission: LessonSubmission) => void;
}) {
  const [answer, setAnswer] = useState(submission?.answer ?? "");
  const [url, setUrl] = useState(submission?.url ?? "");
  const [files, setFiles] = useState<LessonFile[]>(submission?.files ?? []);
  const [uploading, setUploading] = useState<{
    name: string;
    progress: number;
  } | null>(null);
  const [fileError, setFileError] = useState<Error | null>(null);
  const [validation, setValidation] = useState<Error | null>(null);
  const accepted = lesson.assignment ?? {
    acceptText: true,
    acceptLink: true,
    acceptFiles: false,
  };
  const submit = useMutation({
    mutationFn: () =>
      api<LessonSubmission>(
        `${activityPath(courseId, lesson.id)}/submission`,
        "POST",
        {
          versionId,
          answer: accepted.acceptText ? answer.trim() : undefined,
          url: accepted.acceptLink ? url.trim() : undefined,
          uploadIds: accepted.acceptFiles ? files.map((file) => file.id) : [],
        },
      ),
    onSuccess: onSaved,
  });
  async function selectFiles(selected: FileList | null) {
    if (!selected?.length) return;
    setFileError(null);
    const next = Array.from(selected);
    if (files.length + next.length > 3) {
      setFileError(
        new Error("Attach up to 3 files. Remove a file before adding another."),
      );
      return;
    }
    for (const file of next) {
      if (file.size > 10 * 1024 * 1024 || file.size === 0) {
        setFileError(
          new Error(`${file.name} must be between 1 byte and 10 MB.`),
        );
        return;
      }
      if (!/\.(pdf|txt|zip|png|jpe?g|docx)$/i.test(file.name)) {
        setFileError(
          new Error("Choose PDF, TXT, ZIP, PNG, JPG or DOCX files."),
        );
        return;
      }
    }
    try {
      for (const file of next) {
        setUploading({ name: file.name, progress: 0 });
        const uploaded = await uploadLessonFile(
          file,
          { purpose: "assignment", courseId, lessonId: lesson.id },
          (progress) => setUploading({ name: file.name, progress }),
        );
        setFiles((current) => [...current, uploaded]);
      }
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error
          : new Error("The file could not upload. Please retry."),
      );
    } finally {
      setUploading(null);
    }
  }
  function submitAssignment(event: FormEvent) {
    event.preventDefault();
    setValidation(null);
    if (!(
      (accepted.acceptText && answer.trim()) ||
      (accepted.acceptLink && url.trim()) ||
      (accepted.acceptFiles && files.length)
    )) {
      setValidation(
        new Error(
          "Add a written answer, link or file using one of the available options.",
        ),
      );
      return;
    }
    if (accepted.acceptLink && url.trim()) {
      try {
        const parsed = new URL(url.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setValidation(
          new Error(
            "Enter a complete website or repository link starting with https://.",
          ),
        );
        return;
      }
    }
    submit.mutate();
  }
  return (
    <section className="lesson-assignment">
      {submission && (
        <div className="lesson-submitted" role="status">
          <StudentIcon name="check" />
          <div>
            <b>Assignment submitted</b>
            <span>
              Last submitted {new Date(submission.submittedAt).toLocaleString()}
              . You can update your work below.
            </span>
          </div>
        </div>
      )}
      <div className="lesson-section-heading">
        <h2>Your submission</h2>
        <p>Use any of the available options to share your work.</p>
      </div>
      <form onSubmit={submitAssignment}>
        <fieldset
          disabled={submit.isPending || Boolean(uploading)}
          className="lesson-fields"
        >
          {accepted.acceptText && (
            <label className="lesson-field">
              <span>Written answer</span>
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                maxLength={50000}
                rows={9}
                placeholder="Explain your approach and share your answer…"
              />
              <small>Your answer is saved when you submit.</small>
            </label>
          )}
          {accepted.acceptLink && (
            <label className="lesson-field">
              <span>Project or repository link</span>
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                maxLength={2048}
                placeholder="https://github.com/your-name/your-project"
              />
              <small>Make sure your instructor can open the link.</small>
            </label>
          )}
          {accepted.acceptFiles && (
            <div className="lesson-field">
              <span id="assignment-files-label">Attachments</span>
              <div className="lesson-upload-area">
                <StudentIcon name="assign" />
                <div>
                  <b>Attach your work</b>
                  <p>
                    PDF, TXT, ZIP, PNG, JPG or DOCX · up to 3 files · 10 MB each
                  </p>
                </div>
                <label
                  className={`a-btn lesson-file-picker${files.length >= 3 ? " disabled" : ""}`}
                >
                  Choose files
                  <input
                    type="file"
                    accept=".pdf,.txt,.zip,.png,.jpg,.jpeg,.docx"
                    multiple
                    disabled={files.length >= 3}
                    aria-label="Choose assignment files"
                    onChange={(event) => {
                      void selectFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {files.length > 0 && (
                <ul
                  className="lesson-file-list"
                  aria-labelledby="assignment-files-label"
                >
                  {files.map((file) => (
                    <li key={file.id}>
                      <StudentIcon name="page" />
                      <span>
                        <b>{file.fileName}</b>
                        <small>{formatFileSize(file.size)}</small>
                      </span>
                      {submission?.files.some(
                        (saved) => saved.id === file.id,
                      ) && <FileDownload file={file} />}
                      <button
                        type="button"
                        className="lesson-link-button"
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((item) => item.id !== file.id),
                          )
                        }
                        aria-label={`Remove ${file.fileName}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </fieldset>
        {uploading && (
          <div
            className="lesson-upload-progress"
            role="status"
            aria-live="polite"
          >
            <span>
              Uploading {uploading.name}… {Math.round(uploading.progress)}%
            </span>
            <progress value={uploading.progress} max={100} />
          </div>
        )}
        <Status error={fileError || validation || submit.error} />
        <div className="lesson-submit-actions">
          <button
            className="a-btn pri"
            type="submit"
            disabled={submit.isPending || Boolean(uploading)}
          >
            {submit.isPending
              ? "Submitting…"
              : submission
                ? "Update submission"
                : "Submit assignment"}
          </button>
          <span>Submitting completes this activity.</span>
        </div>
      </form>
    </section>
  );
}

function QuizForm({
  courseId,
  versionId,
  lesson,
  submission,
  onSaved,
}: ActivityProps & {
  submission: LessonSubmission | null;
  onSaved: (submission: LessonSubmission) => void;
}) {
  const [taking, setTaking] = useState(!submission);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [validation, setValidation] = useState<Error | null>(null);
  const questions = lesson.quiz?.questions ?? [];
  const passingScore = lesson.quiz?.passingScore ?? 70;
  const submit = useMutation({
    mutationFn: () =>
      api<LessonSubmission>(
        `${activityPath(courseId, lesson.id)}/submission`,
        "POST",
        { versionId, answers },
      ),
    onSuccess: (result) => {
      setTaking(false);
      onSaved(result);
    },
  });
  function submitQuiz(event: FormEvent) {
    event.preventDefault();
    if (questions.some((question) => answers[question.id] === undefined)) {
      setValidation(
        new Error("Choose one answer for every question before submitting."),
      );
      return;
    }
    setValidation(null);
    submit.mutate();
  }
  if (!questions.length)
    return (
      <p className="lesson-notice">
        This quiz has no questions yet. Please contact your organization.
      </p>
    );
  if (submission && !taking) {
    return (
      <section className="lesson-quiz-result">
        <div
          className={`lesson-result-summary${submission.passed ? " passed" : ""}`}
          role="status"
        >
          <div className="lesson-result-score">
            {submission.score}
            <span>%</span>
          </div>
          <div>
            <h2>{submission.passed ? "Quiz passed" : "Keep practising"}</h2>
            <p>
              {submission.passed
                ? "This activity is complete. Review your answers below."
                : `You need ${passingScore}% to complete this activity. Review your answers and try again.`}
            </p>
            <small>
              Submitted {new Date(submission.submittedAt).toLocaleString()}
            </small>
          </div>
        </div>
        <ol className="lesson-quiz-feedback">
          {questions.map((question, index) => {
            const result = submission.quizResults.find(
              (item) => item.questionId === question.id,
            );
            if (!result) return null;
            const correct = result.selectedOption === result.correctOption;
            return (
              <li key={question.id}>
                <div className="lesson-question-heading">
                  <b>Question {index + 1}</b>
                  <span
                    className={`lesson-answer-status${correct ? " correct" : ""}`}
                  >
                    {correct ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <p className="lesson-question-prompt">{question.prompt}</p>
                <p>
                  <b>Your answer:</b>{" "}
                  {question.options[result.selectedOption] ?? "No answer"}
                </p>
                {!correct && (
                  <p>
                    <b>Correct answer:</b>{" "}
                    {question.options[result.correctOption]}
                  </p>
                )}
                {result.explanation && (
                  <p className="lesson-answer-explanation">
                    {result.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <button
          className={`a-btn${submission.passed ? "" : " pri"}`}
          onClick={() => {
            setAnswers({});
            setValidation(null);
            submit.reset();
            setTaking(true);
          }}
        >
          {submission.passed ? "Retake quiz" : "Try again"}
        </button>
      </section>
    );
  }
  return (
    <section className="lesson-quiz">
      <div className="lesson-section-heading">
        <h2>Check your understanding</h2>
        <p>
          {questions.length} questions · choose one answer per question ·{" "}
          {passingScore}% to pass
        </p>
      </div>
      <form onSubmit={submitQuiz}>
        {questions.map((question, index) => (
          <fieldset
            className="lesson-question"
            key={question.id}
            disabled={submit.isPending}
          >
            <legend>
              <span>
                Question {index + 1} of {questions.length}
              </span>
              {question.prompt}
            </legend>
            <div className="lesson-options">
              {question.options.map((option, optionIndex) => (
                <label
                  className={`lesson-option${answers[question.id] === optionIndex ? " selected" : ""}`}
                  key={optionIndex}
                >
                  <input
                    type="radio"
                    name={`quiz-${lesson.id}-${question.id}`}
                    value={optionIndex}
                    checked={answers[question.id] === optionIndex}
                    onChange={() =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: optionIndex,
                      }))
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Status error={validation || submit.error} />
        <div className="lesson-submit-actions">
          <button
            className="a-btn pri"
            type="submit"
            disabled={submit.isPending}
          >
            {submit.isPending ? "Checking answers…" : "Submit quiz"}
          </button>
          <span>
            {Object.keys(answers).length} of {questions.length} answered
          </span>
        </div>
      </form>
    </section>
  );
}

function SubmittedActivity(props: ActivityProps) {
  const query = useQueryClient();
  const refreshProgress = useRefreshProgress(props.courseId);
  const key = `lesson-submission-${props.courseId}-${props.versionId}-${props.lesson.id}`;
  const submission = useStudentData<LessonSubmission | null>(
    key,
    `${activityPath(props.courseId, props.lesson.id)}/submission`,
  );
  function saved(result: LessonSubmission) {
    query.setQueriesData({ queryKey: ["student", key] }, result);
    refreshProgress();
  }
  if (submission.isPending || submission.error)
    return (
      <div className="lesson-submission-loading">
        <Status pending={submission.isPending} error={submission.error} />
        {submission.error && (
          <button className="a-btn" onClick={() => void submission.refetch()}>
            Retry loading submission
          </button>
        )}
      </div>
    );
  const initial = submission.data ?? null;
  return props.lesson.kind === "quiz" ? (
    <QuizForm {...props} submission={initial} onSaved={saved} />
  ) : (
    <AssignmentForm
      key={initial?.submittedAt ?? "new"}
      {...props}
      submission={initial}
      onSaved={saved}
    />
  );
}

export function StudentLessonActivity(props: ActivityProps) {
  const { courseId, lesson, done } = props;
  const refreshProgress = useRefreshProgress(courseId);
  const complete = useMutation({
    mutationFn: () =>
      api(`${activityPath(courseId, lesson.id)}/complete`, "POST"),
    onSuccess: refreshProgress,
  });
  const requiresSubmission =
    lesson.kind === "assignment" || lesson.kind === "quiz";
  return (
    <>
      {lesson.kind === "video" && (
        <LessonVideo courseId={courseId} lesson={lesson} />
      )}
      {lesson.body && (
        <div className="lesson-body">
          <LessonContent body={lesson.body} format={lesson.format} />
        </div>
      )}
      {requiresSubmission ? (
        <SubmittedActivity {...props} />
      ) : (
        <div className="lesson-completion">
          <button
            className={`a-btn${done ? "" : " pri"}`}
            disabled={done || complete.isPending}
            onClick={() => complete.mutate()}
          >
            {done && <StudentIcon name="check" />}
            {done
              ? "Completed"
              : complete.isPending
                ? "Saving…"
                : "Mark as complete"}
          </button>
          <Status error={complete.error} />
        </div>
      )}
    </>
  );
}

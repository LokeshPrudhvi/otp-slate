import type {
  ExamAnswer,
  ExamAttemptView,
  ExamMonitorEvent,
  ExamEventType,
} from "@slate/contracts";

export type ExamTransport = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export type ExamSessionState = {
  view: ExamAttemptView;
  answers: ExamAnswer[];
  dirty: boolean;
  saving: boolean;
  submitting: boolean;
  reloading: boolean;
  error: string;
  conflict: boolean;
};
const copy = (answers: ExamAnswer[]) =>
  answers.map((answer) => ({ ...answer }));

/** Serialize versioned writes while retaining edits made during an in-flight save. */
export class ExamSession {
  state: ExamSessionState;
  private listeners = new Set<() => void>();
  private version = 0;
  private savedVersion = 0;
  private flight: Promise<void> | undefined;
  private serverAnchor: number;
  private localAnchor: number;
  private resumeRetry: (() => void) | undefined;
  constructor(
    view: ExamAttemptView,
    private transport: ExamTransport,
    private clock = () => performance.now(),
  ) {
    this.state = {
      view,
      answers: copy(view.answers),
      dirty: false,
      saving: false,
      submitting: false,
      reloading: false,
      error: "",
      conflict: false,
    };
    this.serverAnchor = Date.parse(view.serverNow);
    this.localAnchor = clock();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  now = () => this.serverAnchor + this.clock() - this.localAnchor;
  remaining = () =>
    Math.max(0, Date.parse(this.state.view.deadlineAt) - this.now());
  private notify(patch: Partial<ExamSessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private received(view: ExamAttemptView) {
    this.serverAnchor = Date.parse(view.serverNow);
    this.localAnchor = this.clock();
  }
  edit(answer: ExamAnswer) {
    if (
      this.state.view.status !== "in_progress" ||
      this.remaining() <= 0 ||
      this.state.conflict ||
      this.state.submitting ||
      this.state.reloading
    )
      return;
    const answers = this.state.answers.filter(
      (item) => item.questionId !== answer.questionId,
    );
    answers.push({ ...answer });
    this.version++;
    this.notify({ answers, dirty: true, error: "" });
  }
  private failed(error: unknown) {
    const conflict =
      this.state.conflict || (error as { status?: number })?.status === 409;
    this.notify({
      conflict,
      error: conflict
        ? "This attempt changed in another tab. Reload the saved attempt before continuing. Your unsaved answers have not overwritten it."
        : (error as Error)?.message ||
          "Could not save. Your latest changes are only in this tab. Reconnect and retry.",
    });
  }
  save(): Promise<void> {
    if (this.flight) return this.flight;
    if (
      !this.state.dirty ||
      this.state.conflict ||
      this.state.submitting ||
      this.remaining() <= 0 ||
      this.state.view.status !== "in_progress"
    )
      return Promise.resolve();
    this.flight = this.saveLoop().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  private waitForRetry(delay: number) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.resumeRetry = undefined;
        resolve();
      };
      const timer = setTimeout(finish, delay);
      this.resumeRetry = finish;
    });
  }
  private async saveLoop() {
    this.notify({ saving: true, error: "" });
    let throttleRetries = 0;
    try {
      while (
        this.state.dirty &&
        !this.state.submitting &&
        this.remaining() > 0 &&
        this.state.view.status === "in_progress"
      ) {
        const sentVersion = this.version;
        let view: ExamAttemptView;
        try {
          view = await this.transport<ExamAttemptView>(
            `student/exam-attempts/${this.state.view.id}/answers`,
            "PUT",
            {
              revision: this.state.view.revision,
              answers: copy(this.state.answers),
            },
          );
        } catch (error) {
          if (
            (error as { status?: number })?.status === 429 &&
            throttleRetries < 2
          ) {
            await this.waitForRetry(650 * ++throttleRetries);
            continue;
          }
          throw error;
        }
        throttleRetries = 0;
        this.received(view);
        this.savedVersion = sentVersion;
        const done = view.status !== "in_progress";
        this.notify({
          view,
          dirty: !done && this.version !== this.savedVersion,
          ...(done ? { answers: copy(view.answers) } : {}),
        });
      }
    } catch (error) {
      this.failed(error);
    } finally {
      this.notify({ saving: false });
    }
  }
  async submit(expired = false) {
    if (
      this.state.submitting ||
      this.state.conflict ||
      this.state.view.status !== "in_progress"
    )
      return;
    this.notify({ submitting: true, error: "" });
    this.resumeRetry?.();
    try {
      await this.flight;
      if (this.state.conflict) return;
      if (this.state.view.status !== "in_progress") return;
      const answers =
        expired || this.remaining() <= 0
          ? this.state.view.answers
          : this.state.answers;
      const view = await this.transport<ExamAttemptView>(
        `student/exam-attempts/${this.state.view.id}/submit`,
        "POST",
        { revision: this.state.view.revision, answers: copy(answers) },
      );
      this.received(view);
      this.savedVersion = this.version;
      this.notify({
        view,
        answers: copy(view.answers),
        dirty: false,
        error: "",
      });
    } catch (error) {
      this.failed(error);
    } finally {
      this.notify({ submitting: false });
    }
  }
  reload(): Promise<void> {
    if (this.flight || this.state.submitting)
      return this.flight || Promise.resolve();
    this.notify({ reloading: true });
    this.flight = this.reloadOnce().finally(() => {
      this.flight = undefined;
      this.notify({ reloading: false });
    });
    return this.flight;
  }
  private async reloadOnce() {
    try {
      const view = await this.transport<ExamAttemptView>(
        `student/exam-attempts/${this.state.view.id}`,
      );
      this.received(view);
      this.savedVersion = ++this.version;
      this.notify({
        view,
        answers: copy(view.answers),
        dirty: false,
        error: "",
        conflict: false,
      });
    } catch (error) {
      this.failed(error);
    }
  }
}

/** Records event types and timestamps only. Never reads clipboard or screen contents. */
export class ExamEventBuffer {
  private queued: ExamMonitorEvent[] = [];
  private flight = false;
  constructor(
    private send: (events: ExamMonitorEvent[]) => Promise<unknown>,
    private now = () => Date.now(),
  ) {}
  add(type: ExamEventType) {
    if (this.queued.length >= 100) return;
    this.queued.push({
      id: crypto.randomUUID(),
      type,
      occurredAt: new Date(this.now()).toISOString(),
    });
  }
  async flush() {
    if (this.flight || !this.queued.length) return;
    this.flight = true;
    const batch = this.queued.slice(0, 20);
    try {
      await this.send(batch);
      const ids = new Set(batch.map((event) => event.id));
      this.queued = this.queued.filter((event) => !ids.has(event.id));
    } catch {
      /* Retry the same event IDs next time; a network failure must not block answers. */
    } finally {
      this.flight = false;
    }
  }
}

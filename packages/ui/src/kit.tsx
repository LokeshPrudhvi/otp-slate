import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import type { Identity, Portal } from "@slate/contracts";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [twoFactorClient()],
});
const Context = createContext<Portal>("student");
const labels: Record<Portal, string> = {
  student: "Learning portal",
  platform: "Platform Admin",
  organization: "Organization insights",
};
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (method === "GET" && signal) {
    // Let same-turn observer cleanup cancel a read before opening its connection.
    await Promise.resolve();
    signal.throwIfAborted();
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      "We could not connect. Check your connection and retry.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data?.message === "string"
        ? data.message
        : "The request could not be completed.",
    );
  return data as T;
}
export function usePortal() {
  return useContext(Context);
}
export function useMe({ poll = false }: { poll?: boolean } = {}) {
  const portal = usePortal();
  const client = useQueryClient();
  return useQuery({
    queryKey: ["me", portal],
    queryFn: ({ signal }) =>
      api<Identity>(
        `me?portal=${portal}${portal === "student" && client.getQueryData(["me", portal]) ? "&passive=1" : ""}`,
        "GET",
        undefined,
        signal,
      ),
    retry: false,
    staleTime: 5_000,
    refetchOnWindowFocus: "always",
    refetchInterval: poll && portal === "student" ? 20_000 : false,
  });
}
export function useData<T>(key: string, path: string, enabled = true) {
  const portal = usePortal();
  return useQuery({
    queryKey: [portal, key],
    queryFn: ({ signal }) => api<T>(path, "GET", undefined, signal),
    enabled,
  });
}
export function PortalRoot({
  portal,
  children,
}: {
  portal: Portal;
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Context.Provider value={portal}>
        <BrowserRouter>{children}</BrowserRouter>
      </Context.Provider>
    </QueryClientProvider>
  );
}
export function Logo() {
  return (
    <span className="logo-mark" aria-label="OTP Slate">
      otp
      <span />
    </span>
  );
}
export function Icon({ name = "grid" }: { name?: string }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1z" />
        <path d="M12 5v15" />
      </>
    ),
    toolkit: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3" />
      </>
    ),
    code: (
      <>
        <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
      </>
    ),
    exam: (
      <>
        <rect x="5" y="3" width="14" height="19" rx="2" />
        <path d="m8 11 2 2 5-5M8 17h8" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8m3 3a5 5 0 0 1 2 6" />
      </>
    ),
    jobs: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V3h8v4m-13 7h18" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M7 17v-5m5 5V7m5 10V3" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H3V3h6m5 4 5 5-5 5M7 12h12" />
      </>
    ),
    resume: (
      <>
        <path d="M5 2h9l5 5v15H5zm9 0v6h5M8 12h8m-8 4h8" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.grid}
    </svg>
  );
}
export function PageHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <Icon name="book" />
        <span />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="form-error" role="alert">
      {error instanceof Error ? error.message : "Please retry."}
    </p>
  ) : null;
}
export function DataState({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error?: unknown;
  children: ReactNode;
}) {
  if (pending)
    return (
      <p className="loading" role="status">
        Loading…
      </p>
    );
  if (error) return <ErrorMessage error={error} />;
  return <>{children}</>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Protected() {
  // One persistent route guard owns polling; consumers share its identity query.
  const me = useMe({ poll: true }),
    location = useLocation();
  if (me.isPending)
    return (
      <div className="loading-screen" role="status">
        Opening your workspace…
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to="/login" replace />;
  if (me.error)
    return (
      <div className="connection-screen">
        <Logo />
        <h1>We could not open your workspace</h1>
        <ErrorMessage error={me.error} />
        <button className="btn" onClick={() => me.refetch()}>
          Retry
        </button>{" "}
        <Link to="/login">Return to sign in</Link>
      </div>
    );
  if (me.data?.onboardingStep && location.pathname !== "/onboarding")
    return <Navigate to="/onboarding" replace />;
  if (!me.data?.onboardingStep && location.pathname === "/onboarding")
    return <Navigate to="/" replace />;
  return <Outlet />;
}
export interface NavigationItem {
  to: string;
  label: string;
  icon: string;
  feature?: string;
  demoOnly?: boolean;
}
export function Shell({ navigation }: { navigation: NavigationItem[] }) {
  const portal = usePortal(),
    me = useMe(),
    query = useQueryClient(),
    navigate = useNavigate();
  const logout = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error("We could not sign you out. Please retry.");
    },
    onSuccess: () => {
      query.clear();
      navigate("/login", { replace: true });
    },
  });
  const identity = me.data!;
  return (
    <div
      className={`app-shell ${portal === "organization" ? "analytics-shell" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/">
          <Logo />
          {portal === "organization" && (
            <span>
              OTP Slate<small>Organization insights</small>
            </span>
          )}
        </Link>
        {portal === "organization" && (
          <div className="org-identity">
            <span className="eyebrow">YOUR ORGANIZATION</span>
            <strong>{identity.organizationName}</strong>
            <span className="badge">View only</span>
          </div>
        )}
        <nav aria-label="Main navigation">
          {navigation
            .filter(
              (item) =>
                (!item.demoOnly || identity.demo) &&
                (!item.feature || identity.features.includes(item.feature)),
            )
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-link"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <Icon name="logout" />
            <span>{logout.isPending ? "Signing out" : "Sign out"}</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            <strong>OTP Slate</strong>
            <small>{labels[portal]}</small>
          </span>
          <div className="identity">
            <span className="avatar">
              {identity.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{identity.name}</strong>
              <small>{identity.organizationName || "Platform workspace"}</small>
              {identity.demo && <small>Local sample data</small>}
            </div>
          </div>
        </header>
        <main id="main" className="page">
          <ErrorMessage error={logout.error} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
export function Login() {
  const portal = usePortal(),
    query = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"password" | "mfa" | "reset">("password"),
    [notice, setNotice] = useState(
      new URLSearchParams(location.search).get("setup") === "complete"
        ? "Phone verified. Sign in with your new password to continue."
        : "",
    );
  const mutation = useMutation({
    mutationFn: async () => {
      if (step === "reset") {
        await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setNotice(
          "If this account exists, a reset email will be sent. Contact Platform Admin if it does not arrive.",
        );
        return;
      }
      const result =
        step === "mfa"
          ? await authClient.twoFactor.verifyTotp({ code })
          : await authClient.signIn.email({ email, password });
      if (result.error)
        throw new Error(result.error.message || "Check your sign-in details.");
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        setStep("mfa");
        return;
      }
      const identity = await api<Identity>(`me?portal=${portal}`);
      await query.cancelQueries();
      query.clear();
      query.setQueryData(["me", portal], identity);
      navigate("/", { replace: true });
    },
  });
  return (
    <div className="login-screen">
      <section className="login-art">
        <Logo />
        <span className="eyebrow">LEARN. PRACTISE. MOVE FORWARD.</span>
        <h1>
          {portal === "organization"
            ? "See learning take shape."
            : portal === "platform"
              ? "Make every learning journey count."
              : "Your next chapter starts here."}
        </h1>
        <p>
          {portal === "organization"
            ? "A clear view of your students, their progress and their potential."
            : portal === "platform"
              ? "Bring your organizations, learning content and opportunities together."
              : "Build skills, practise with purpose and get ready for what comes next."}
        </p>
        <div className="login-graphic" aria-hidden="true">
          <div />
          <div />
          <div />
          <span>otp</span>
        </div>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="eyebrow">{labels[portal].toUpperCase()}</span>
          <h2>
            {step === "reset"
              ? "Reset your password"
              : step === "mfa"
                ? "Verify your sign-in"
                : "Welcome back"}
          </h2>
          <p>
            {step === "reset"
              ? "Enter the email address assigned to your account."
              : step === "mfa"
                ? "Enter the six-digit code from your authenticator app."
                : "Sign in with the account issued to you."}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            {step === "mfa" ? (
              <Field label="Authentication code">
                <input
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="Email address">
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                {step === "password" && (
                  <Field label="Password">
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
            <ErrorMessage error={mutation.error} />
            {notice && (
              <p role="status" className="success-note">
                {notice}
              </p>
            )}
            <button className="btn primary full" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Please wait…"
                : step === "reset"
                  ? "Send reset link"
                  : step === "mfa"
                    ? "Verify"
                    : "Sign in"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setStep(step === "reset" ? "password" : "reset");
              mutation.reset();
              setNotice("");
            }}
          >
            {step === "reset" ? "Back to sign in" : "Forgot password?"}
          </button>
          <p className="login-help">
            Need an account? Contact your organization.
            <br />
            Learning access is assigned by Platform Admin.
          </p>
        </div>
      </section>
    </div>
  );
}
export function ResetPassword() {
  const location = useLocation(),
    navigate = useNavigate(),
    [password, setPassword] = useState("");
  const token = new URLSearchParams(location.search).get("token");
  const mutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("This reset link is invalid or expired.");
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => navigate("/login", { replace: true }),
  });
  return (
    <div className="connection-screen">
      <Logo />
      <h1>Choose a new password</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="New password">
          <input
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorMessage error={mutation.error} />
        <button className="btn primary" disabled={mutation.isPending || !token}>
          Update password
        </button>
      </form>
      <Link to="/login">Return to sign in</Link>
    </div>
  );
}
export function Onboarding() {
  const me = useMe(),
    query = useQueryClient(),
    navigate = useNavigate(),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [mfaSetup, setMfaSetup] = useState<{
      totpURI: string;
      backupCodes: string[];
    } | null>(null);
  const step = me.data?.onboardingStep;
  const mutation = useMutation({
    mutationFn: async () => {
      if (step === "password") {
        if (password !== confirm)
          throw new Error("The new passwords do not match.");
        await api("onboarding/password", "POST", {
          currentPassword: current,
          newPassword: password,
        });
      } else if (step === "phone") {
        if (!challenge) {
          const result = await api<{ challengeId: string }>(
            "onboarding/phone",
            "POST",
            { phone },
          );
          setChallenge(result.challengeId);
          return;
        }
        await api("onboarding/phone/verify", "POST", {
          challengeId: challenge,
          code,
        });
        query.clear();
        navigate("/login?setup=complete", { replace: true });
        return;
      } else if (step === "mfa") {
        if (!mfaSetup) {
          const result = await authClient.twoFactor.enable({
            password: current,
          });
          if (result.error) throw new Error(result.error.message);
          if (result.data?.method !== "totp")
            throw new Error("Authenticator setup was not available.");
          setMfaSetup(result.data);
          return;
        }
        const result = await authClient.twoFactor.verifyTotp({ code });
        if (result.error) throw new Error(result.error.message);
      }
      await query.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <div className="onboarding-screen">
      <div className="onboarding-brand">
        <Logo />
        <strong>OTP Slate</strong>
      </div>
      <section className="onboarding-card">
        <span className="eyebrow">LET’S GET YOU READY</span>
        <h1>
          {step === "password"
            ? "Make this account yours"
            : step === "phone"
              ? "Verify your phone number"
              : "Secure your admin account"}
        </h1>
        <p>
          {step === "password"
            ? "Replace your temporary password with a new password of at least 12 characters."
            : step === "phone"
              ? "We will send a verification code to this number on WhatsApp."
              : "Set up an authenticator app before opening the platform workspace."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {step === "password" ? (
            <>
              <Field label="Current temporary password">
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="New password">
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            </>
          ) : step === "phone" ? (
            <>
              <Field
                label="Phone number"
                hint="Include the country code, for example +91 followed by your number."
              >
                <input
                  type="tel"
                  required
                  disabled={Boolean(challenge)}
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              {challenge && (
                <>
                  <Field label="WhatsApp verification code">
                    <input
                      required
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setChallenge("");
                      setCode("");
                    }}
                  >
                    Change number or request a new code
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {!mfaSetup ? (
                <Field label="Your current password">
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </Field>
              ) : (
                <>
                  <p>Add this setup URI to your authenticator app:</p>
                  <textarea
                    readOnly
                    aria-label="Authenticator setup URI"
                    value={mfaSetup.totpURI}
                  />
                  <details>
                    <summary>Save your recovery codes</summary>
                    <pre>{mfaSetup.backupCodes.join("\n")}</pre>
                  </details>
                  <Field label="Authentication code">
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                </>
              )}
            </>
          )}
          <ErrorMessage error={mutation.error} />
          <button className="btn primary full" disabled={mutation.isPending}>
            {mutation.isPending
              ? "Please wait…"
              : step === "password"
                ? "Save password and continue"
                : step === "phone" && !challenge
                  ? "Send WhatsApp code"
                  : step === "mfa" && !mfaSetup
                    ? "Set up authenticator"
                    : "Verify and continue"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={async () => {
            await authClient.signOut();
            query.clear();
            window.location.assign("/login");
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
export function NotFound() {
  return (
    <Empty
      title="This page is not available"
      action={
        <Link className="btn" to="/">
          Go to dashboard
        </Link>
      }
    >
      Return to your dashboard to continue.
    </Empty>
  );
}
export function Form({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
    >
      {children}
    </form>
  );
}

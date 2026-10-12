import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authClient, useMe } from "@slate/ui";
import type { Identity } from "@slate/contracts";
import { Artwork, Status } from "./design";

export function AuthFrame({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`a-login open student-auth ${className}`}>
      <div className="lg-art">
        <Artwork name="logo" />
        <div>
          <h2>Learn, practise, get hired.</h2>
          <p style={{ opacity: 0.8, maxWidth: "34ch" }}>
            One place for your courses, coding practice and placement
            preparation.
          </p>
        </div>
        <small style={{ opacity: 0.6 }}>OTP Slate</small>
      </div>
      <section className="lg-form">
        <span className="hub-eyebrow">OTP SLATE · STUDENT PORTAL</span>
        <h3>{title}</h3>
        <p style={{ margin: 0, color: "#4b5b73" }}>{description}</p>
        {children}
      </section>
    </div>
  );
}
export function StudentLogin() {
  const me = useMe({ refetchOnMount: "always" });
  // Validate even a cached identity on entry, without resetting form state
  // during subsequent window-focus checks.
  if (me.isPending || !me.isFetchedAfterMount)
    return (
      <AuthFrame
        title="Opening your workspace…"
        description="Checking your existing session."
      >
        <p className="auth-message" role="status">
          Please wait…
        </p>
      </AuthFrame>
    );
  if (me.isSuccess && me.data)
    return (
      <Navigate to={me.data.onboardingStep ? "/onboarding" : "/"} replace />
    );
  const guest =
    me.error instanceof ApiError &&
    (me.error.status === 401 || me.error.status === 403);
  if (!guest)
    return (
      <AuthFrame
        title="We couldn't check your session"
        description="Please retry to continue to your workspace."
      >
        <Status error={me.error} />
        <button
          className="lg-btn"
          disabled={me.isFetching}
          onClick={() => void me.refetch()}
        >
          {me.isFetching ? "Checking…" : "Retry"}
        </button>
      </AuthFrame>
    );
  return (
    <StudentLoginForm
      sessionError={
        me.error instanceof ApiError && me.error.status === 403
          ? me.error
          : null
      }
    />
  );
}
function StudentLoginForm({ sessionError }: { sessionError: Error | null }) {
  const location = useLocation(),
    navigate = useNavigate(),
    query = useQueryClient();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"password" | "mfa" | "reset">("password");
  const [notice, setNotice] = useState(
    new URLSearchParams(location.search).get("setup") === "complete"
      ? "Phone verified. Sign in with your new password to continue."
      : "",
  );
  const signIn = useMutation({
    mutationFn: async () => {
      if (step === "reset") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error)
          throw new Error(result.error.message || "Please retry.");
        setNotice(
          "If this account exists, a reset email will be sent. Contact your placement team if it does not arrive.",
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
      const identity = await api<Identity>("me?portal=student");
      await query.cancelQueries();
      query.clear();
      query.setQueryData(["me", "student"], identity);
      navigate("/", { replace: true });
    },
  });
  return (
    <AuthFrame
      title={
        step === "reset"
          ? "Reset your password"
          : step === "mfa"
            ? "Verify your sign-in"
            : "Welcome back."
      }
      description={
        step === "reset"
          ? "Enter the email address assigned to your account."
          : step === "mfa"
            ? "Enter the six-digit code from your authenticator app."
            : "Your next step starts here. Sign in to learn, practise and prepare for your career."
      }
    >
      <Status error={sessionError} />
      {notice && (
        <p className="auth-message" role="status">
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        {step === "mfa" ? (
          <>
            <label htmlFor="student-code">Authentication code</label>
            <input
              id="student-code"
              className="student-code"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="student-email">Email address</label>
            <input
              id="student-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {step === "password" && (
              <>
                <label htmlFor="student-password">Password</label>
                <input
                  id="student-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </>
            )}
          </>
        )}
        <Status error={signIn.error} />
        <button className="lg-btn" disabled={signIn.isPending}>
          {signIn.isPending
            ? "Please wait…"
            : step === "reset"
              ? "Send reset link"
              : step === "mfa"
                ? "Verify"
                : "Sign in"}
        </button>
      </form>
      <button
        className="auth-link"
        onClick={() => {
          setStep(step === "reset" ? "password" : "reset");
          signIn.reset();
          setNotice("");
        }}
      >
        {step === "reset" ? "Back to sign in" : "Forgot password?"}
      </button>
      <p className="auth-help">
        New to OTP Slate?{" "}
        <Link className="auth-link" to="/register">
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}
export function StudentResetPassword() {
  const location = useLocation(),
    navigate = useNavigate(),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const token = new URLSearchParams(location.search).get("token");
  const reset = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("This reset link is invalid or expired.");
      if (password !== confirm) throw new Error("The passwords do not match.");
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => navigate("/login", { replace: true }),
  });
  return (
    <AuthFrame
      title="Choose a new password"
      description="Use a password of at least 12 characters to secure your account."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate();
        }}
      >
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="reset-confirm">Confirm new password</label>
        <input
          id="reset-confirm"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Status error={reset.error} />
        <button className="lg-btn" disabled={!token || reset.isPending}>
          {reset.isPending ? "Updating…" : "Update password"}
        </button>
      </form>
      <Link className="auth-link" to="/login">
        Return to sign in
      </Link>
    </AuthFrame>
  );
}
export function StudentOnboarding() {
  const me = useMe(),
    query = useQueryClient(),
    navigate = useNavigate();
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState("");
  const step = me.data?.onboardingStep;
  const complete = useMutation({
    mutationFn: async () => {
      if (step === "password") {
        if (password !== confirm)
          throw new Error("The new passwords do not match.");
        await api("onboarding/password", "POST", {
          currentPassword: current,
          newPassword: password,
        });
        await query.invalidateQueries({ queryKey: ["me"] });
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
      }
    },
  });
  return (
    <AuthFrame
      title={
        step === "password"
          ? "Make this account yours"
          : "Verify your phone number"
      }
      description={
        step === "password"
          ? "Replace your temporary password before you start learning."
          : "We will send a six-digit verification code to your number on WhatsApp."
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          complete.mutate();
        }}
      >
        {step === "password" ? (
          <>
            <label htmlFor="onboarding-current">
              Current temporary password
            </label>
            <input
              id="onboarding-current"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <label htmlFor="onboarding-new">New password</label>
            <input
              id="onboarding-new"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <label htmlFor="onboarding-confirm">Confirm new password</label>
            <input
              id="onboarding-confirm"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="onboarding-phone">
              Phone number, including country code
            </label>
            <input
              id="onboarding-phone"
              type="tel"
              required
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+91 98765 43210"
              autoComplete="tel"
              disabled={Boolean(challenge)}
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\s/g, ""))
              }
            />
            {challenge && (
              <>
                <label htmlFor="onboarding-code">
                  WhatsApp verification code
                </label>
                <input
                  id="onboarding-code"
                  className="student-code"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  className="auth-link"
                  type="button"
                  onClick={() => {
                    setChallenge("");
                    setCode("");
                    complete.reset();
                  }}
                >
                  Change number or request another code
                </button>
              </>
            )}
          </>
        )}
        <Status error={complete.error} />
        <button className="lg-btn" disabled={complete.isPending}>
          {complete.isPending
            ? "Please wait…"
            : step === "password"
              ? "Save password and continue"
              : challenge
                ? "Verify and continue"
                : "Send WhatsApp code"}
        </button>
      </form>
      <button
        className="auth-link"
        onClick={async () => {
          const result = await authClient.signOut();
          if (!result.error) {
            query.clear();
            navigate("/login", { replace: true });
          }
        }}
      >
        Sign out
      </button>
    </AuthFrame>
  );
}

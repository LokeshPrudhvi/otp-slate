import { useState } from "react";
import { View } from "react-native";
import { router, Redirect, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Identity,
  Organization,
  OrganizationBranch,
} from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Field,
  Button,
  Notice,
  Card,
  Icon,
  Select,
  State,
} from "../components/ui";
import { api, authClient, API_ORIGIN } from "../lib/api";
import { usePage, useSession } from "../lib/session";
import { colors } from "../theme";
export function LoginScreen() {
  const { me, refresh } = useSession();
  const client = useQueryClient();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error)
        throw new Error(result.error.message || "Could not sign in.");
      client.removeQueries({ queryKey: ["native"] });
      return client.fetchQuery({
        queryKey: ["native", "identity"],
        queryFn: () => api<Identity>("me?portal=student"),
      });
    },
    onSuccess: (identity) => {
      void refresh();
      router.replace(identity.onboardingStep ? "/onboarding" : "/");
    },
  });
  if (me?.role === "student")
    return <Redirect href={me.onboardingStep ? "/onboarding" : "/"} />;
  return (
    <Screen>
      <View style={{ paddingVertical: 24, gap: 14 }}>
        <Title>Your next chapter starts here.</Title>
        <Label muted>
          Learn, practise and prepare for your next opportunity.
        </Label>
      </View>
      <Card>
        <Title>Sign in</Title>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
        />
        {login.error && <Notice error>{login.error.message}</Notice>}
        <Button
          title="Sign in"
          loading={login.isPending}
          disabled={!email.trim() || !password}
          onPress={() => login.mutate()}
        />
        <Button
          title="Forgot password?"
          secondary
          onPress={() => router.push("/reset-password")}
        />
      </Card>
      <Button
        title="Request student access"
        secondary
        onPress={() => router.push("/register")}
      />
      <Label muted>
        Your organization approves access before you start learning.
      </Label>
    </Screen>
  );
}
export function RegisterScreen() {
  const organizations = usePage<Organization[]>("registration/organizations");
  const [org, setOrg] = useState(""),
    [branch, setBranch] = useState("");
  const branches = usePage<OrganizationBranch[]>(
    `registration/organizations/${org}/branches`,
    Boolean(org),
  );
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    studentId: "",
    cohort: "",
  });
  const selected = branches.data?.find((b) => b.code === branch);
  const request = useMutation({
    mutationFn: () =>
      api("registration/requests", "POST", {
        ...form,
        email: form.email.trim(),
        organizationId: org,
        branchCode: selected!.code,
        branchName: selected!.name,
      }),
  });
  if (request.isSuccess)
    return (
      <Screen back>
        <Card style={{ alignItems: "center", paddingVertical: 36 }}>
          <Icon name="clock" color={colors.amber} size={54} />
          <Title>Awaiting admin approval</Title>
          <Label>
            Your request has been received. After approval, your temporary
            password will arrive by email.
          </Label>
        </Card>
        <Button
          title="Back to sign in"
          onPress={() => router.replace("/login")}
        />
      </Screen>
    );
  return (
    <Screen back title="Request student access">
      <Title>Join your learning community</Title>
      <Label muted>
        Your branch code is filled from your organization’s academic branches.
      </Label>
      <State
        pending={organizations.isPending}
        error={organizations.error}
        onRetry={() => void organizations.refetch()}
      />
      {Object.entries({
        name: "Full name",
        email: "Email address",
        phone: "Phone number",
        studentId: "Student ID / roll number",
        cohort: "Cohort / graduation year",
      }).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          value={form[key as keyof typeof form]}
          onChangeText={(value) => setForm({ ...form, [key]: value })}
          autoCapitalize={key === "email" ? "none" : "words"}
          keyboardType={
            key === "email"
              ? "email-address"
              : key === "phone"
                ? "phone-pad"
                : "default"
          }
        />
      ))}
      <Select
        label="Organization"
        value={org}
        options={(organizations.data || []).map((o) => ({
          value: o.id,
          label: o.name,
        }))}
        onChange={(value) => {
          setOrg(value);
          setBranch("");
        }}
      />
      <Select
        label="Academic branch"
        disabled={!org || branches.isPending}
        value={branch}
        options={(branches.data || []).map((b) => ({
          value: b.code,
          label: `${b.name} · ${b.code}`,
        }))}
        onChange={setBranch}
      />
      <Field
        label="Branch code"
        value={selected?.code || ""}
        editable={false}
      />
      {branches.error && <Notice error>{branches.error.message}</Notice>}
      {request.error && <Notice error>{request.error.message}</Notice>}
      <Button
        title="Submit request"
        loading={request.isPending}
        disabled={
          !org ||
          !selected ||
          !form.name.trim() ||
          !form.email.trim() ||
          !form.phone.trim() ||
          !form.studentId.trim()
        }
        onPress={() => request.mutate()}
      />
    </Screen>
  );
}
export function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const reset = useMutation({
    mutationFn: async () => {
      const result = token
        ? await authClient.resetPassword({ newPassword: password, token })
        : await authClient.requestPasswordReset({
            email: email.trim(),
            redirectTo: `${API_ORIGIN}/reset-password`,
          });
      if (result.error)
        throw new Error(result.error.message || "Please retry.");
    },
  });
  return (
    <Screen back>
      <Title>
        {reset.isSuccess
          ? token
            ? "Password updated"
            : "Check your email"
          : token
            ? "Set a new password"
            : "Reset password"}
      </Title>
      <Label muted>
        {token
          ? "Use a unique password of at least 12 characters."
          : "If an account exists, we will email a secure reset link. Finish the reset from your email, then return to sign in."}
      </Label>
      {!reset.isSuccess &&
        (token ? (
          <>
            <Field
              label="New password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Field
              label="Confirm password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
            />
          </>
        ) : (
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        ))}
      {reset.error && <Notice error>{reset.error.message}</Notice>}
      {!reset.isSuccess && (
        <Button
          title={token ? "Update password" : "Send reset link"}
          loading={reset.isPending}
          disabled={
            token ? password.length < 12 || password !== confirm : !email.trim()
          }
          onPress={() => reset.mutate()}
        />
      )}
      <Button
        title="Back to sign in"
        secondary
        onPress={() => router.replace("/login")}
      />
    </Screen>
  );
}
export function OnboardingScreen() {
  const { me, refresh, pending } = useSession();
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState("");
  const action = useMutation({
    mutationFn: async () => {
      if (me?.onboardingStep === "password")
        await api("onboarding/password", "POST", {
          currentPassword: current,
          newPassword: next,
        });
      await refresh();
    },
  });
  if (pending)
    return (
      <Screen>
        <State pending />
      </Screen>
    );
  if (!me) return <Redirect href="/login" />;
  if (!me.onboardingStep) return <Redirect href="/" />;
  if (me.onboardingStep === "mfa")
    return (
      <Screen>
        <Title>Extra verification required</Title>
        <Label>
          Complete your organization-required verification through your portal.
        </Label>
      </Screen>
    );
  return (
    <Screen>
      <Label muted>Secure your account</Label>
      <Title>Set your new password</Title>
      <Label muted>
        Replace the temporary password from your welcome email.
      </Label>
      <Field
        label="Temporary password"
        secureTextEntry
        value={current}
        onChangeText={setCurrent}
      />
      <Field
        label="New password"
        secureTextEntry
        value={next}
        onChangeText={setNext}
      />
      <Field
        label="Confirm new password"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />
      <Label muted>
        At least 12 characters. Choose a password you do not use elsewhere.
      </Label>
      {action.error && <Notice error>{action.error.message}</Notice>}
      <Button
        title="Save password & continue"
        loading={action.isPending}
        disabled={!current || next.length < 12 || next !== confirm}
        onPress={() => action.mutate()}
      />
    </Screen>
  );
}

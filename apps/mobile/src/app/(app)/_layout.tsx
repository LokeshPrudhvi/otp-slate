import { Redirect, Stack } from "expo-router";
import { useSession } from "../../lib/session";
import { ApiError } from "../../lib/api";
import { Screen, State, Button, Title, Label } from "../../components/ui";
export default function AppLayout() {
  const { me, pending, error, refresh, signOut } = useSession();
  if (pending)
    return (
      <Screen>
        <State pending />
      </Screen>
    );
  if (!me) {
    if (error instanceof ApiError && error.status === 403)
      return (
        <Screen>
          <Title>Access unavailable</Title>
          <Label>{error.message}</Label>
          <Button title="Use another account" onPress={() => void signOut()} />
        </Screen>
      );
    if ((error instanceof ApiError && error.status === 401) || !error)
      return <Redirect href="/login" />;
    return (
      <Screen>
        <State error={error} onRetry={() => void refresh()} />
      </Screen>
    );
  }
  if (me.role !== "student")
    return (
      <Screen>
        <Title>Student accounts only</Title>
        <Label>
          This account belongs to another portal. Use a student account to open
          this app.
        </Label>
        <Button title="Sign out" onPress={() => void signOut()} />
      </Screen>
    );
  if (me.onboardingStep) return <Redirect href="/onboarding" />;
  return (
    <Stack
      screenOptions={{ headerShown: false, animation: "slide_from_right" }}
    />
  );
}

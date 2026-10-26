import { useState } from "react";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { View, Text, Pressable } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../lib/session";
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 28,
        gap: 18,
        backgroundColor: "#F2F5FA",
      }}
    >
      <Text style={{ fontSize: 26, fontWeight: "700", color: "#0F2747" }}>
        Let’s try that again.
      </Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: "#64748B" }}>
        This screen could not open. Retry to continue.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{ backgroundColor: "#0F2747", borderRadius: 8, padding: 16 }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "slide_from_right",
            }}
          />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

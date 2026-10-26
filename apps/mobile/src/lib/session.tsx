import { createContext, useContext, useEffect, type ReactNode } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient, focusManager } from "@tanstack/react-query";
import type { Identity } from "@slate/contracts";
import { api, authClient, ApiError } from "./api";

const Context = createContext<{
  me: Identity | undefined;
  pending: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}>({
  me: undefined,
  pending: true,
  error: null,
  refresh: async () => {},
  signOut: async () => {},
});
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const identity = useQuery({
    queryKey: ["native", "identity"],
    queryFn: async () => {
      if (!(await authClient.getCookie()))
        throw new ApiError(401, "Sign in to continue.");
      return api<Identity>("me?portal=student");
    },
    retry: false,
    staleTime: 15_000,
  });
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => listener.remove();
  }, []);
  const signOut = async () => {
    const result = await authClient.signOut();
    if (result.error)
      throw new Error(
        result.error.message || "Could not sign out. Please retry.",
      );
    client.clear();
    client.setQueryData(["native", "identity"], null);
  };
  return (
    <Context.Provider
      value={{
        me:
          identity.error instanceof ApiError &&
          [401, 403].includes(identity.error.status)
            ? undefined
            : identity.data || undefined,
        pending: identity.isPending,
        error: identity.error,
        refresh: () => identity.refetch(),
        signOut,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
export function usePage<T>(path: string, enabled = true) {
  const { me } = useSession();
  const query = useQuery({
    queryKey: ["native", path, me?.id, me?.access?.revision],
    queryFn: ({ signal }) => api<T>(path, "GET", undefined, signal),
    enabled,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) &&
      count < 1,
    staleTime: 30_000,
  });
  // A refetch can retain cached data after access has been revoked. Hide it.
  return query.error instanceof ApiError && [401, 403].includes(query.error.status)
    ? { ...query, data: undefined }
    : query;
}
export function useFeature(name: string) {
  return Boolean(useSession().me?.features.includes(name));
}

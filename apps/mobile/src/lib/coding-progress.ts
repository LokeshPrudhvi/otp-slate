import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session";
export interface CodingProgress {
  solved: string[];
  attempting: string[];
  bookmarks: string[];
  drafts: Record<string, { language: string; code: string }>;
}
const blank = (): CodingProgress => ({
  solved: [],
  attempting: [],
  bookmarks: [],
  drafts: {},
});
const queues = new Map<string, Promise<void>>();
export function useCodingProgress() {
  const { me } = useSession(),
    client = useQueryClient(),
    key = `slate:${me?.id}:coding`,
    queryKey = ["native", key];
  const query = useQuery({
    queryKey,
    enabled: Boolean(me),
    queryFn: async () => {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return blank();
      const value = JSON.parse(raw);
      if (
        !Array.isArray(value.solved) ||
        !Array.isArray(value.attempting) ||
        !Array.isArray(value.bookmarks) ||
        typeof value.drafts !== "object" ||
        !value.drafts
      )
        throw new Error("Your saved coding progress could not be read.");
      return value as CodingProgress;
    },
    staleTime: Infinity,
  });
  const update = async (change: (state: CodingProgress) => CodingProgress) => {
    const current = client.getQueryData<CodingProgress>(queryKey);
    if (!current) throw new Error("Wait for your saved progress to load.");
    const next = change(current);
    client.setQueryData(queryKey, next);
    const previous = queues.get(key) || Promise.resolve();
    const job = previous
      .catch(() => {})
      .then(() => AsyncStorage.setItem(key, JSON.stringify(next)));
    queues.set(key, job);
    await job;
  };
  return { ...query, update };
}

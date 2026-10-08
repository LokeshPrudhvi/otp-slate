export type PracticeResult = {
  id: string;
  title: string;
  score: number;
  completedAt: string;
};

const key = (studentId: string) => `slate-practice-history:${studentId}`;

export function readPracticeHistory(studentId: string): PracticeResult[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(key(studentId)) || "[]",
    );
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (item): item is PracticeResult =>
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.score === "number" &&
          Number.isFinite(item.score) &&
          item.score >= 0 &&
          item.score <= 100 &&
          typeof item.completedAt === "string" &&
          Number.isFinite(Date.parse(item.completedAt)),
      )
      .slice(-30);
  } catch {
    return [];
  }
}

export function savePracticeResult(
  studentId: string,
  result: PracticeResult,
): boolean {
  try {
    const history = readPracticeHistory(studentId).filter(
      (item) => item.id !== result.id,
    );
    localStorage.setItem(
      key(studentId),
      JSON.stringify([...history, result].slice(-30)),
    );
    return true;
  } catch {
    return false;
  }
}

export interface PlacementLink {
  title: string;
  url: string;
}
export interface PlacementResource {
  id: string;
  kind: "certification" | "company";
  title: string;
  provider: string;
  description: string;
  logoUrl: string;
  logoId?: string | null;
  url: string;
  hiringProcedure: string;
  papers: PlacementLink[];
  practiceQuestions: { question: string; answer: string }[];
  status: "draft" | "published" | "archived";
  updatedAt: string;
}
export type PlacementResourceInput = Omit<
  PlacementResource,
  "id" | "updatedAt"
>;

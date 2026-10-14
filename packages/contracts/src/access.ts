export const featureKeys = [
  "courses",
  "toolkit",
  "crt",
  "compiler",
  "practice",
  "live-exams",
  "inbox",
  "announcements",
  "self-assessment",
  "jobs",
  "resume",
  "rankings",
] as const;
export type FeatureKey = (typeof featureKeys)[number];
export const practiceModuleIds = [
  "aptitude",
  "reasoning",
  "typing",
  "interview",
  "web-development",
  "fullstack",
  "competitive-coding",
] as const;
export type PracticeModuleId = (typeof practiceModuleIds)[number];
export const toolkitTrackIds = [
  "hiring",
  "crt",
  "dsa",
  "fullstack",
  "competitive",
] as const;
export type ToolkitTrackId = (typeof toolkitTrackIds)[number];
export interface AccessPolicy {
  features: FeatureKey[] | null;
  courseIds: string[] | null;
  practiceModuleIds: PracticeModuleId[] | null;
  toolkitTrackIds: ToolkitTrackId[] | null;
}
export interface PortalDisplay {
  portalTitle: string;
  toolkitTitle: string;
  welcomeText: string;
}
export interface EffectiveAccess {
  features: FeatureKey[];
  courseIds: string[];
  practiceModuleIds: PracticeModuleId[];
  toolkitTrackIds: ToolkitTrackId[];
  revision: number;
  display: PortalDisplay;
}
export type AccessSelections = Pick<
  EffectiveAccess,
  "features" | "courseIds" | "practiceModuleIds" | "toolkitTrackIds"
>;
export interface AccessWorkspace {
  organization: { id: string; name: string; status: string };
  revision: number;
  organizationPolicy: AccessPolicy;
  display: PortalDisplay;
  branches: {
    code: string;
    name: string;
    studentCount: number;
    policy: AccessPolicy;
  }[];
  students: {
    id: string;
    name: string;
    email: string;
    studentId: string | null;
    status: string;
    branchName: string | null;
    branchCode: string | null;
    cohort: string | null;
    policy: AccessPolicy;
    effective: EffectiveAccess;
    baseline: AccessSelections;
  }[];
  catalog: {
    defaults: AccessSelections;
    features: { id: FeatureKey; name: string; description: string }[];
    courses: {
      id: string;
      title: string;
      track: string;
      version: number;
      status?: "published" | "archived";
    }[];
    practiceModules: {
      id: PracticeModuleId;
      name: string;
      description: string;
      count: number;
      sample: boolean;
      requiresCompiler: boolean;
    }[];
    toolkitTracks: { id: ToolkitTrackId; name: string }[];
  };
}
export interface UpdateAccess {
  revision: number;
  scope: "organization" | "branch" | "student";
  targetId?: string;
  policy: AccessPolicy;
  branchName?: string;
  branchCode?: string | null;
  display?: PortalDisplay;
}

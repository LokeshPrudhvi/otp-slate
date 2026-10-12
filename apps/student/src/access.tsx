import type { ReactNode } from "react";
import { Link, Outlet, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FeatureKey, Identity } from "@slate/contracts";
import { api, useMe } from "@slate/ui";

export function hasAccess(identity: Identity | undefined, feature: string) {
  return Boolean(identity?.features.includes(feature));
}

export function hasToolkitTrack(identity: Identity | undefined, track: string) {
  return (
    hasAccess(identity, "toolkit") &&
    Boolean(identity?.access?.toolkitTrackIds.some((id) => id === track))
  );
}

export function hasCodingAccess(identity: Identity | undefined) {
  return (
    hasAccess(identity, "practice") &&
    hasAccess(identity, "compiler") &&
    Boolean(identity?.access?.practiceModuleIds.includes("competitive-coding"))
  );
}

const pathFeatures: Record<string, FeatureKey> = {
  courses: "courses",
  practice: "practice",
  exams: "live-exams",
  jobs: "jobs",
  rankings: "rankings",
  announcements: "announcements",
  compiler: "compiler",
};

function resourceAccessKey(
  identity: Identity | undefined,
  feature: FeatureKey | undefined,
  path: string,
) {
  const allowed = feature ? hasAccess(identity, feature) : false;
  if (feature === "courses") {
    const courseId = path.split("/")[2];
    return [
      allowed,
      courseId
        ? identity?.access?.courseIds.includes(courseId)
        : [...(identity?.access?.courseIds ?? [])].sort(),
    ];
  }
  if (feature === "practice" || feature === "live-exams") {
    return [
      allowed,
      hasAccess(identity, "practice"),
      hasAccess(identity, "compiler"),
      [...(identity?.access?.practiceModuleIds ?? [])].sort(),
    ];
  }
  return [allowed];
}

/** Isolate changed permissions without restarting a session when another student changes. */
export function useStudentData<T>(key: string, path: string, enabled = true) {
  const me = useMe();
  const feature = pathFeatures[path.split("/")[1]];
  return useQuery({
    queryKey: ["student", key, resourceAccessKey(me.data, feature, path)],
    queryFn: ({ signal }) => api<T>(path, "GET", undefined, signal),
    enabled:
      enabled && Boolean(me.data) && (!feature || hasAccess(me.data, feature)),
  });
}

export function AccessUnavailable() {
  return (
    <div className="a-page">
      <div className="a-head">
        <h1 className="a-h1">Learning access</h1>
      </div>
      <div className="practice-no-results">
        <h2>This section is not assigned to your account</h2>
        <p>
          Your organization manages the learning and tools available to you.
          Return to your dashboard to continue.
        </p>
        <Link className="a-btn" to="/">
          Return to dashboard →
        </Link>
      </div>
    </div>
  );
}

export function AccessRoute({
  feature,
  coding = false,
  children,
}: {
  feature: FeatureKey;
  coding?: boolean;
  children?: ReactNode;
}) {
  const me = useMe(),
    { id, track } = useParams(),
    [params] = useSearchParams();
  const allowed =
    hasAccess(me.data, feature) &&
    (!coding || hasCodingAccess(me.data)) &&
    (feature !== "courses" ||
      !id ||
      Boolean(me.data?.access?.courseIds.includes(id))) &&
    (feature !== "toolkit" || !track || hasToolkitTrack(me.data, track)) &&
    (feature !== "practice" ||
      !params.has("exam") ||
      hasAccess(me.data, "live-exams"));
  if (!allowed) return <AccessUnavailable />;
  return children ?? <Outlet />;
}

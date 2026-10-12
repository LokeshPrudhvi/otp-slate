import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  AccessPolicy,
  AccessWorkspace,
  FeatureKey,
  Organization,
  PortalDisplay,
  UpdateAccess,
} from "@slate/contracts";
import {
  ApiError,
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  Icon,
  PageHead,
  useData,
} from "@slate/ui";
import { AdminSelect } from "./select";
import { CreateBranch } from "./branch-create";
import "./access.css";

type Scope = UpdateAccess["scope"];
type Selection = { scope: Scope; id: string };
type ListKey = "courseIds" | "practiceModuleIds" | "toolkitTrackIds";
type Option = { id: string; label: string; detail?: string; blocked?: string };
const emptyPolicy = (): AccessPolicy => ({
  features: null,
  courseIds: null,
  practiceModuleIds: null,
  toolkitTrackIds: null,
});
const scopeLabels = {
  organization: "Organization",
  branch: "Branches",
  student: "Students",
};
const featureIcons: Partial<Record<FeatureKey, string>> = {
  courses: "book",
  toolkit: "toolkit",
  compiler: "code",
  practice: "exam",
  "live-exams": "exam",
  inbox: "mail",
  announcements: "mail",
  "self-assessment": "chart",
  jobs: "jobs",
  resume: "resume",
  rankings: "chart",
};

function UpdateIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
    </svg>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  inherited,
  readOnly,
  noun,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  inherited?: boolean;
  readOnly?: boolean;
  noun: string;
}) {
  const [search, setSearch] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const searchId = useId();
  const filtered = options.filter((item) =>
    `${item.label} ${item.detail || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const enabled = filtered.filter((item) => !item.blocked);
  const selected = options.filter((item) => value.includes(item.id));
  return (
    <div className={`access-multi ${disabled ? "is-disabled" : ""}`}>
      <details
        ref={details}
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current) {
            details.current.open = false;
            details.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`${label}: ${selected.length} selected`}>
          <span>
            <strong>
              {selected.length
                ? `${selected.length} ${noun} selected`
                : readOnly ? `No ${noun} selected` : `Choose ${noun}`}
            </strong>
            <small>
              {readOnly ? "Saved selection · view only" : inherited
                ? "Inherited selection"
                : "Search and select multiple items"}
            </small>
          </span>
          <svg className="access-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="access-options">
          <label className="sr-only" htmlFor={searchId}>
            Search {noun}
          </label>
          <input
            id={searchId}
            type="search"
            placeholder={`Search ${noun}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {!disabled && (
            <div className="access-option-actions">
              <button
                type="button"
                onClick={() =>
                  onChange([
                    ...new Set([...value, ...enabled.map((item) => item.id)]),
                  ])
                }
              >
                Select {search ? "matching" : "all"}
              </button>
              <button type="button" onClick={() => onChange([])}>
                Clear selection
              </button>
              <span>{filtered.length} available</span>
            </div>
          )}
          <div className="access-option-list">
            {filtered.length ? (
              filtered.map((item) => (
                <label
                  key={item.id}
                  className={item.blocked ? "is-blocked" : ""}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(item.id)}
                    disabled={
                      disabled ||
                      Boolean(item.blocked && !value.includes(item.id))
                    }
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...value, item.id]
                          : value.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.blocked || item.detail}</small>
                  </span>
                </label>
              ))
            ) : (
              <p className="access-option-empty">
                {search
                  ? "No matches. Try another search."
                  : `No ${noun} available yet.`}
              </p>
            )}
          </div>
        </div>
      </details>
      {selected.length > 0 && (
        <div className="access-selected-chips">
          {selected.slice(0, 4).map((item) => (
            <span key={item.id}>{item.label}</span>
          ))}
          {selected.length > 4 && <span>+{selected.length - 4} more</span>}
        </div>
      )}
    </div>
  );
}

function AccessEditor({
  workspace,
  selection,
  onSaved,
  onDirty,
  onPending,
  readOnly,
}: {
  workspace: AccessWorkspace;
  selection: Selection;
  onSaved: (workspace: AccessWorkspace, selection: Selection) => void;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  readOnly: boolean;
}) {
  const [currentWorkspace, setCurrentWorkspace] = useState(workspace);
  const student = currentWorkspace.students.find(
    (item) => item.id === selection.id,
  );
  const existingBranch = currentWorkspace.branches.find(
    (item) => item.code === selection.id,
  );
  const initialPolicy =
    selection.scope === "organization"
      ? currentWorkspace.organizationPolicy
      : selection.scope === "branch"
        ? existingBranch?.policy || emptyPolicy()
        : student?.policy || emptyPolicy();
  const [policy, setPolicy] = useState<AccessPolicy>(() =>
    structuredClone(initialPolicy),
  );
  const [display, setDisplay] = useState<PortalDisplay>({
    ...workspace.display,
  });
  const [branchCode, setBranchCode] = useState(
    selection.scope === "branch"
      ? existingBranch?.code || ""
      : student?.branchCode || "",
  );
  const [reviewedRevision, setReviewedRevision] = useState(workspace.revision);
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const [loadingConflict, setLoadingConflict] = useState(false);
  const [conflictReviewed, setConflictReviewed] = useState(false);
  const isOrg = selection.scope === "organization";
  const parentBranch = currentWorkspace.branches.find(
    (item) => item.code === branchCode,
  );
  const organizationFeatures =
    currentWorkspace.organizationPolicy.features ||
    currentWorkspace.catalog.features.map((item) => item.id);
  const parentPolicy =
    selection.scope === "student"
      ? parentBranch?.policy || emptyPolicy()
      : currentWorkspace.organizationPolicy;
  const baseline =
    selection.scope === "student" && student
      ? student.baseline
      : currentWorkspace.catalog.defaults;
  const inheritedFeatures =
    parentPolicy.features ??
    currentWorkspace.organizationPolicy.features ??
    baseline.features;
  const selectedFeatures =
    policy.features ??
    (isOrg ? currentWorkspace.catalog.defaults.features : inheritedFeatures);
  const effectiveFeatures = selectedFeatures.filter(
    (item) => isOrg || organizationFeatures.includes(item),
  );
  const initialBranch =
    selection.scope === "branch"
      ? existingBranch?.code || ""
      : student?.branchCode || "";
  const dirty = !readOnly && (
    JSON.stringify(policy) !== JSON.stringify(initialPolicy) ||
    (isOrg &&
      JSON.stringify(display) !== JSON.stringify(currentWorkspace.display)) ||
    branchCode !== initialBranch);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function inheritedList(key: ListKey): string[] {
    if (!isOrg) {
      const inherited =
        parentPolicy[key] ?? currentWorkspace.organizationPolicy[key];
      if (inherited !== null) return inherited;
    }
    if (key === "courseIds" && selection.scope !== "student") {
      return [
        ...new Set(
          currentWorkspace.students
            .filter((item) => isOrg || item.branchCode === branchCode)
            .flatMap((item) => item.baseline.courseIds),
        ),
      ];
    }
    return baseline[key];
  }
  function selectedList(key: ListKey): string[] {
    return policy[key] ?? inheritedList(key);
  }
  function effectiveList(key: ListKey): string[] {
    const ceiling = currentWorkspace.organizationPolicy[key];
    return selectedList(key).filter(
      (id) => isOrg || ceiling === null || ceiling.includes(id as never),
    );
  }
  function setList(key: ListKey, items: string[] | null) {
    const selection = key === "courseIds" && items ? items.filter((id) =>
      currentWorkspace.catalog.courses.find((course) => course.id === id)?.status !== "archived" || initialPolicy.courseIds?.includes(id),
    ) : items;
    setPolicy((previous) => ({ ...previous, [key]: selection }));
  }
  function setFeature(id: FeatureKey, checked: boolean) {
    setPolicy((previous) => ({
      ...previous,
      features: checked
        ? [...new Set([...selectedFeatures, id])]
        : selectedFeatures.filter((item) => item !== id),
    }));
  }
  const save = useMutation({
    mutationFn: () =>
      api<AccessWorkspace>(
        `platform/organizations/${workspace.organization.id}/access`,
        "PUT",
        {
          revision: reviewedRevision,
          scope: selection.scope,
          ...(!isOrg
            ? {
                targetId:
                  selection.scope === "branch"
                    ? branchCode.trim().toUpperCase()
                    : selection.id,
              }
            : {}),
          policy,
          ...(selection.scope === "student"
            ? { branchCode: branchCode || null }
            : {}),
          ...(isOrg ? { display } : {}),
        } satisfies UpdateAccess,
      ),
    onSuccess: (updated) =>
      onSaved(updated, {
        ...selection,
        id:
          selection.scope === "branch"
            ? branchCode.trim().toUpperCase()
            : selection.id,
      }),
  });
  useEffect(() => onPending(save.isPending), [save.isPending, onPending]);
  const stale = save.error instanceof ApiError && save.error.status === 409;
  async function reviewLatest() {
    setLoadingConflict(true);
    setRefreshError(null);
    try {
      const latest = await api<AccessWorkspace>(
        `platform/organizations/${workspace.organization.id}/access`,
      );
      setCurrentWorkspace(latest);
      setReviewedRevision(latest.revision);
      setConflictReviewed(true);
      save.reset();
    } catch (error) {
      setRefreshError(error as Error);
    } finally {
      setLoadingConflict(false);
    }
  }
  function reset() {
    setPolicy(structuredClone(initialPolicy));
    setDisplay({ ...currentWorkspace.display });
    setBranchCode(initialBranch);
    setReviewedRevision(currentWorkspace.revision);
    setConflictReviewed(false);
    save.reset();
  }

  const title = isOrg
    ? "Organization defaults"
    : selection.scope === "branch"
      ? existingBranch?.name || "Branch access"
      : student?.name || "Student access";
  const affected = isOrg
    ? currentWorkspace.students.length
    : selection.scope === "branch"
      ? currentWorkspace.students.filter(
          (item) => item.branchCode === branchCode,
        ).length
      : 1;
  const courseOptions = currentWorkspace.catalog.courses.map((course) => ({
    id: course.id,
    label: course.title,
    detail: `${course.track === "general" ? "General learning" : course.track} · ${course.status === "archived" ? "Archived" : "Published"} v${course.version}`,
    blocked:
      course.status === "archived" && !initialPolicy.courseIds?.includes(course.id)
        ? "Archived · unavailable for new selections"
        : !isOrg &&
      currentWorkspace.organizationPolicy.courseIds !== null &&
      !currentWorkspace.organizationPolicy.courseIds.includes(course.id)
        ? "Unavailable in this organization"
        : undefined,
  }));
  const practiceOptions = currentWorkspace.catalog.practiceModules.map(
    (module) => ({
      id: module.id,
      label: module.name,
      detail: `${module.count} activities${module.sample ? " · Sample library" : ""}${module.requiresCompiler ? " · Uses compiler" : ""}`,
      blocked:
        !isOrg &&
        currentWorkspace.organizationPolicy.practiceModuleIds !== null &&
        !currentWorkspace.organizationPolicy.practiceModuleIds.includes(
          module.id,
        )
          ? "Unavailable in this organization"
          : undefined,
    }),
  );
  const trackOptions = currentWorkspace.catalog.toolkitTracks.map((track) => ({
    id: track.id,
    label: track.name,
    blocked:
      !isOrg &&
      currentWorkspace.organizationPolicy.toolkitTrackIds !== null &&
      !currentWorkspace.organizationPolicy.toolkitTrackIds.includes(track.id)
        ? "Unavailable in this organization"
        : undefined,
  }));
  const previewFeatures = effectiveFeatures;
  const lists: {
    key: ListKey;
    label: string;
    noun: string;
    feature: FeatureKey;
    description: string;
    options: Option[];
  }[] = [
    {
      key: "courseIds",
      label: "Course enrollments",
      noun: "courses",
      feature: "courses",
      description: "Choose the published courses these students can learn.",
      options: courseOptions,
    },
    {
      key: "practiceModuleIds",
      label: "Practice library",
      noun: "practice modules",
      feature: "practice",
      description:
        "Build a focused practice library with the modules they need.",
      options: practiceOptions,
    },
    {
      key: "toolkitTrackIds",
      label: "Toolkit sections",
      noun: "toolkit sections",
      feature: "toolkit",
      description: "Select the learning sections displayed inside the toolkit.",
      options: trackOptions,
    },
  ];
  return (
    <form
      className="access-editor"
      aria-busy={save.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && !stale) save.mutate();
      }}
    >
      <div className="access-editor-main" inert={save.isPending}>
        <header className="access-editor-heading">
          <div>
            <span className="eyebrow">
              {isOrg
                ? "01 / ORGANIZATION"
                : selection.scope === "branch"
                  ? "02 / BRANCH"
                  : "03 / STUDENT"}
            </span>
            <h2>{title}</h2>
            <p>
              {readOnly ? "Review saved learning settings. Restore the organization to make changes." : isOrg
                ? "Set the portal and learning options available across this organization."
                : selection.scope === "branch"
                  ? "Give an academic branch its own learning path."
                  : `${student?.email || ""} · ${student?.studentId || "Student account"}`}
            </p>
          </div>
          <span className="access-count-pill">
            {affected} {affected === 1 ? "student" : "students"}
          </span>
        </header>
        {selection.scope === "branch" && (
          <section className="access-card">
            <div className="access-section-title">
              <Icon name="users" />
              <div>
                <h3>Academic branch</h3>
                <p>Students with this branch code receive these defaults.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Branch name">
                <input
                  required
                  maxLength={120}
                  placeholder="Mechanical Engineering"
                  value={existingBranch?.name || ""}
                  readOnly
                />
              </Field>
              <Field label="Branch code">
                <input
                  required
                  placeholder="ME"
                  value={branchCode}
                  readOnly
                />
              </Field>
            </div>
          </section>
        )}
        {selection.scope === "student" && (
          <section className="access-card access-branch-assignment">
            <div>
              <h3>Academic branch</h3>
              <p>
                Branch defaults are applied when no student override is set.
              </p>
            </div>
            <AdminSelect
              aria-label="Student academic branch"
              value={branchCode}
              disabled={readOnly}
              onChange={setBranchCode}
              searchable
              options={[{ value: "", label: "No branch · organization defaults" }, ...currentWorkspace.branches.map(branch => ({ value: branch.code, label: `${branch.name} (${branch.code})` }))]}
            />
          </section>
        )}

        <section className="access-card">
          <div className="access-section-title">
            <Icon name="grid" />
            <div>
              <h3>Student portal</h3>
              <p>
                Choose the sections students see in navigation and on their
                dashboard.
              </p>
            </div>
          </div>
          {isOrg && (
            <label className="access-inherit">
              <input
                type="checkbox"
                checked={policy.features !== null}
                disabled={readOnly}
                onChange={(event) =>
                  setPolicy((previous) => ({
                    ...previous,
                    features: event.target.checked
                      ? [...effectiveFeatures]
                      : null,
                  }))
                }
              />
              <span>
                Customize portal sections for this organization
                <small>
                  When off, keep the current core sections and each student’s
                  career tools.
                </small>
              </span>
              <span className="access-source-tag">
                {policy.features === null ? "Existing defaults" : "Customized"}
              </span>
            </label>
          )}
          {!isOrg && (
            <label className="access-inherit">
              <input
                type="checkbox"
                checked={policy.features === null}
                disabled={readOnly}
                onChange={(event) =>
                  setPolicy((previous) => ({
                    ...previous,
                    features: event.target.checked
                      ? null
                      : [...effectiveFeatures],
                  }))
                }
              />
              <span>
                Use{" "}
                {selection.scope === "student" && parentBranch
                  ? `${parentBranch.code} branch`
                  : "organization"}{" "}
                section settings
                <small>
                  Turn this off to choose sections for{" "}
                  {selection.scope === "branch"
                    ? "this branch"
                    : "this student"}
                  .
                </small>
              </span>
              <span className="access-source-tag">
                {policy.features === null ? "Inherited" : "Customized"}
              </span>
            </label>
          )}
          <div className="access-feature-grid">
            {currentWorkspace.catalog.features
              .filter((feature) => feature.id !== "compiler")
              .map((feature) => {
                const blocked =
                  !isOrg && !organizationFeatures.includes(feature.id);
                return (
                  <label
                    key={feature.id}
                    className={`access-feature ${effectiveFeatures.includes(feature.id) ? "is-on" : ""} ${blocked ? "is-blocked" : ""}`}
                  >
                    <span className="access-feature-icon">
                      <Icon name={featureIcons[feature.id] || "grid"} />
                    </span>
                    <span>
                      <strong>{feature.name}</strong>
                      <small>
                        {blocked
                          ? "Disabled for the organization"
                          : feature.description}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={feature.name}
                      checked={effectiveFeatures.includes(feature.id)}
                      disabled={
                        readOnly ||
                        (!effectiveFeatures.includes(feature.id) && blocked) ||
                        policy.features === null
                      }
                      onChange={(event) =>
                        setFeature(feature.id, event.target.checked)
                      }
                    />
                  </label>
                );
              })}
          </div>
          <label
            className={`access-compiler ${effectiveFeatures.includes("compiler") ? "is-on" : ""}`}
          >
            <span className="access-compiler-icon">
              <Icon name="code" />
            </span>
            <span>
              <strong>Compiler & code execution</strong>
              <small>
                Allow the online compiler and coding workspaces. Turn off for
                organizations that do not need programming.
              </small>
              {!isOrg && !organizationFeatures.includes("compiler") && (
                <em>Disabled for the organization</em>
              )}
            </span>
            <input
              type="checkbox"
              aria-label="Compiler & code execution"
              checked={effectiveFeatures.includes("compiler")}
              disabled={
                readOnly ||
                (!isOrg && !organizationFeatures.includes("compiler")) ||
                policy.features === null
              }
              onChange={(event) => setFeature("compiler", event.target.checked)}
            />
          </label>
          <p className="access-footnote">
            {readOnly ? "All student portal access is paused while this organization is archived. " : "Dashboard, account settings and help stay available. "}Organization
            settings are the maximum access a branch or student can receive.
          </p>
        </section>

        <section className="access-card">
          <div className="access-section-title">
            <Icon name="book" />
            <div>
              <h3>Learning selections</h3>
              <p>{readOnly ? "Open a dropdown to review saved selections." : "Select several items in each dropdown, then update once."}</p>
            </div>
          </div>
          {lists.map((list) => (
            <div className="access-learning-row" key={list.key}>
              <div className="access-learning-title">
                <div>
                  <h4>{list.label}</h4>
                  <p>{list.description}</p>
                </div>
                <span
                  className={`access-source-tag ${policy[list.key] !== null ? "custom" : ""}`}
                >
                  {policy[list.key] === null
                    ? isOrg
                      ? list.key === "courseIds"
                        ? "Existing assignments"
                        : "Default selection"
                      : "Inherited"
                    : "Custom selection"}
                </span>
              </div>
              <label className="access-list-mode">
                <input
                  type="checkbox"
                  checked={policy[list.key] !== null}
                  disabled={readOnly}
                  onChange={(event) =>
                    setList(
                      list.key,
                      event.target.checked ? effectiveList(list.key) : null,
                    )
                  }
                />
                <span>
                  {isOrg
                    ? `Choose ${list.noun} for this organization`
                    : `Customize ${list.noun} for this ${selection.scope}`}
                </span>
              </label>
              <MultiSelect
                label={list.label}
                noun={list.noun}
                options={list.options}
                value={selectedList(list.key)}
                inherited={policy[list.key] === null}
                disabled={readOnly || policy[list.key] === null}
                readOnly={readOnly}
                onChange={(items) => setList(list.key, items)}
              />
              {list.key === "courseIds" && currentWorkspace.catalog.courses.some((course) => course.status === "archived") && <p className="access-field-note">Archived courses can keep their saved assignments, but cannot be newly selected. Switching inherited courses to a custom selection excludes archived courses unless they were already saved here.</p>}
              {!readOnly && policy[list.key] === null && (
                <p className="access-field-note">
                  {isOrg && list.key === "courseIds"
                    ? "Keep existing individual course enrollments. Enable a custom selection to give the same courses to every student and set the organization’s course limit."
                    : isOrg
                      ? "Keep the current default availability. Enable a custom selection to explicitly choose modules, including an empty selection."
                      : `Uses ${selection.scope === "student" && parentBranch ? "branch" : "organization"} selections. Existing enrollments remain when no shared course selection is configured.`}
                </p>
              )}
              {!effectiveFeatures.includes(list.feature) && (
                <p className="access-field-note warning">
                  This section is hidden. Your selections are kept for when you
                  enable it.
                </p>
              )}
              {list.key === "practiceModuleIds" &&
                selectedList(list.key).some(
                  (id) =>
                    currentWorkspace.catalog.practiceModules.find(
                      (item) => item.id === id,
                    )?.requiresCompiler,
                ) &&
                !effectiveFeatures.includes("compiler") && (
                  <p className="access-field-note warning">
                    Coding activities stay unavailable while the compiler is
                    disabled.
                  </p>
                )}
              {!readOnly && list.key === "courseIds" && !list.options.length && (
                <Link to="/courses">Create and publish a course →</Link>
              )}
            </div>
          ))}
          <p className="access-footnote">
            Course progress is retained when access changes. Existing students
            keep their assigned course version; new assignments use the latest
            published version.
          </p>
        </section>

        {isOrg && (
          <section className="access-card">
            <div className="access-section-title">
              <Icon name="grid" />
              <div>
                <h3>Make the portal their own</h3>
                <p>Use language that fits this organization’s curriculum.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Portal title">
                <input
                  required
                  maxLength={80}
                  value={display.portalTitle}
                  readOnly={readOnly}
                  placeholder="Learning portal"
                  onChange={(event) =>
                    setDisplay((previous) => ({
                      ...previous,
                      portalTitle: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Toolkit title">
                <input
                  required
                  maxLength={80}
                  value={display.toolkitTitle}
                  readOnly={readOnly}
                  placeholder="Your learning toolkit"
                  onChange={(event) =>
                    setDisplay((previous) => ({
                      ...previous,
                      toolkitTitle: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <Field label="Dashboard welcome message">
              <textarea
                maxLength={240}
                rows={2}
                value={display.welcomeText}
                readOnly={readOnly}
                placeholder="Continue learning and build your skills."
                onChange={(event) =>
                  setDisplay((previous) => ({
                    ...previous,
                    welcomeText: event.target.value,
                  }))
                }
              />
            </Field>
          </section>
        )}
      </div>

      <aside className="access-preview">
        <div className="access-preview-heading">
          <span className="eyebrow">STUDENT EXPERIENCE</span>
          <span className="access-preview-live">{readOnly ? "Saved configuration" : "Draft preview"}</span>
        </div>
        <h3>{display.portalTitle || "Learning portal"}</h3>
        <p>
          {isOrg
            ? "Organization defaults"
            : selection.scope === "branch"
              ? `${branchCode || "Branch"} defaults`
              : "Effective student access"}
        </p>
        <div className="access-mini-nav">
          <span className="always">
            <Icon name="grid" />
            Dashboard <small>{readOnly ? "Access paused" : "Always available"}</small>
          </span>
          {previewFeatures.map((id) => (
            <span key={id}>
              <Icon name={featureIcons[id] || "grid"} />
              {
                currentWorkspace.catalog.features.find(
                  (feature) => feature.id === id,
                )?.name
              }
            </span>
          ))}
          <span className="always">
            <Icon name="users" />
            Account & help
          </span>
        </div>
        <div className="access-preview-counts">
          <div>
            <strong>
              {effectiveFeatures.includes("courses")
                ? effectiveList("courseIds").length
                : 0}
            </strong>
            <span>
              Courses
              {policy.courseIds === null && isOrg ? " across students" : ""}
            </span>
          </div>
          <div>
            <strong>
              {effectiveFeatures.includes("practice")
                ? effectiveList("practiceModuleIds").filter(
                    (id) =>
                      effectiveFeatures.includes("compiler") ||
                      !currentWorkspace.catalog.practiceModules.find(
                        (item) => item.id === id,
                      )?.requiresCompiler,
                  ).length
                : 0}
            </strong>
            <span>Practice modules</span>
          </div>
        </div>
        <p className="access-preview-note">
          {selection.scope !== "student" && policy.features === null
            ? "Individual defaults may include additional career tools. "
            : ""}
          An organization restriction always applies, even when a branch or
          student has a custom selection.
        </p>
      </aside>

      {!readOnly && <footer className="access-save-bar">
        <div>
          <strong>
            {dirty ? "You have unpublished changes" : "Settings are up to date"}
          </strong>
          <span>
            {dirty
              ? `Update to apply access for ${isOrg ? "this organization" : selection.scope === "branch" ? "this branch" : "this student"}.`
              : "Selections are saved only when you click Update access."}
          </span>
        </div>
        <div className="access-save-actions">
          <button
            type="button"
            className="btn"
            disabled={!dirty || save.isPending}
            onClick={reset}
          >
            Reset
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={
              !dirty ||
              save.isPending ||
              stale ||
              loadingConflict
            }
          >
            <UpdateIcon />
            {save.isPending ? "Updating…" : "Update access"}
          </button>
        </div>
      </footer>}
      {!readOnly && (save.error || refreshError || conflictReviewed) && (
        <div className="access-save-message" role="alert">
          <ErrorMessage error={refreshError || save.error} />
          {stale && (
            <>
              <p>
                Another admin updated this organization. Your draft is kept.
                Load the latest settings and review the new limits before trying
                again.
              </p>
              <button
                type="button"
                className="btn"
                disabled={loadingConflict}
                onClick={() => void reviewLatest()}
              >
                {loadingConflict ? "Loading…" : "Review latest settings"}
              </button>
            </>
          )}
          {conflictReviewed && (
            <p>
              The latest organization limits are loaded. Your draft has been
              kept; review it before updating. Saving replaces this target’s
              saved selection with your draft.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

export function LearningAccess() {
  const [params, setParams] = useSearchParams();
  const routerNavigate = useNavigate();
  const organizations = useData<Organization[]>(
    "organizations",
    "platform/organizations",
  );
  const [organizationId, setOrganizationId] = useState(
    params.get("organizationId") || "",
  );
  const [selection, setSelection] = useState<Selection>({
    scope: params.get("studentId") ? "student" : params.get("tab") === "branches" ? "branch" : "organization",
    id: params.get("studentId") || params.get("branchCode") || "",
  });
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<
    { organizationId: string; selection: Selection } | { href: string } | null
  >(null);
  const client = useQueryClient();
  const workspace = useQuery({
    queryKey: ["platform", "access", organizationId],
    queryFn: () =>
      api<AccessWorkspace>(`platform/organizations/${organizationId}/access`),
    enabled: Boolean(organizationId),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const selectedOrganization = organizations.data?.find((organization) => organization.id === organizationId);
  const archived = selectedOrganization?.status === "archived" || workspace.data?.organization.status === "archived";
  useEffect(() => {
    if (archived) {
      setDirty(false);
      setPendingNavigation(null);
      setNotice("");
    }
  }, [archived]);
  useEffect(() => {
    if (selectedOrganization && workspace.data && selectedOrganization.status !== workspace.data.organization.status) {
      void client.invalidateQueries({ queryKey: ["platform", "access", organizationId], exact: true });
    }
  }, [selectedOrganization?.status, workspace.data?.organization.status, organizationId, client]);
  useEffect(() => {
    if (!organizationId && organizations.data?.[0])
      setOrganizationId((organizations.data.find(organization => organization.status === "active") ?? organizations.data[0]).id);
  }, [organizationId, organizations.data]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const next = new URL(anchor.href, window.location.href);
      if (
        next.origin !== window.location.origin ||
        next.href === window.location.href
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!saving)
        setPendingNavigation({
          href: `${next.pathname}${next.search}${next.hash}`,
        });
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty, saving]);
  function navigate(nextOrganizationId: string, next: Selection) {
    if (saving) return;
    if (dirty) {
      setPendingNavigation({
        organizationId: nextOrganizationId,
        selection: next,
      });
      return;
    }
    applyNavigation(nextOrganizationId, next);
  }
  function applyNavigation(nextOrganizationId: string, next: Selection) {
    setOrganizationId(nextOrganizationId);
    setSelection(next);
    setDirty(false);
    setSearch("");
    setBranchFilter("");
    setNotice("");
    setPendingNavigation(null);
    setEditorVersion((value) => value + 1);
    setParams(
      {
        organizationId: nextOrganizationId,
        ...(next.scope === "branch" ? { tab: "branches", ...(next.id ? { branchCode: next.id } : {}) } : {}),
        ...(next.scope === "student" && next.id ? { studentId: next.id } : {}),
      },
      { replace: true },
    );
  }
  const data = workspace.data;
  const filteredStudents = useMemo(
    () =>
      data?.students.filter(
        (student) =>
          `${student.name} ${student.email} ${student.studentId || ""}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (!branchFilter || student.branchCode === branchFilter),
      ) || [],
    [data?.students, search, branchFilter],
  );
  const filteredBranches =
    data?.branches.filter((branch) =>
      `${branch.name} ${branch.code}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const canView = (selection.scope !== "student" ||
    Boolean(data?.students.find((student) => student.id === selection.id))) &&
    (selection.scope !== "branch" || Boolean(data?.branches.some((branch) => branch.code === selection.id)));
  return (
    <div className="learning-access">
      <header className="access-hero">
      <PageHead
        title="Learning access"
        description="A tailored learning portal for every organization, branch and student."
        action={
          <div className="admin-header-tools">
            <div className="admin-header-select">
              <Field label="Organization">
                <AdminSelect
                  id="access-organization"
                  aria-label="Organization"
                  value={organizationId}
                  disabled={saving || organizations.isPending}
                  onChange={value => navigate(value, { scope: "organization", id: "" })}
                  searchable
                  options={[{ value: "", label: "Choose an organization", disabled: true }, ...(organizations.data || []).map(organization => ({ value: organization.id, label: `${organization.name}${organization.status === "archived" ? " (Archived)" : ""}` }))]}
                />
              </Field>
            </div>
          </div>
        }
      />
      <section className="access-context" aria-label="Selected organization">
        <div className="access-context-symbol">
          <Icon name="users" />
        </div>
        <div className="access-context-name">
          <strong>{selectedOrganization?.name || "Choose an organization"}</strong>
          <small>{archived ? "Archived · view only" : "Organization defaults, branch rules and individual access"}</small>
        </div>
        <div className="access-context-stat">
          <strong>{data?.students.length ?? "—"}</strong>
          <span>{data?.students.length === 1 ? "student" : "students"}</span>
        </div>
        <div className="access-context-stat">
          <strong>{data?.branches.length ?? "—"}</strong>
          <span>{data?.branches.length === 1 ? "branch" : "branches"}</span>
        </div>
        <Link className="btn access-context-catalog" to="/courses">
          Course catalog <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <div className="access-scope-tabs" role="tablist" aria-label="Access level">
        {(["organization", "branch", "student"] as Scope[]).map((scope, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={selection.scope === scope}
            aria-controls="access-scope-panel"
            id={`access-scope-${scope}`}
            key={scope}
            className={selection.scope === scope ? "active" : ""}
            disabled={saving || !data || workspace.isPending}
            onClick={() => navigate(organizationId, {
              scope,
              id: scope === "branch" ? data?.branches[0]?.code || ""
                : scope === "student" ? data?.students[0]?.id || "" : "",
            })}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {scopeLabels[scope]}
            <small>{scope === "organization" ? "Defaults & limits" : scope === "branch" ? "Shared learning paths" : "Individual overrides"}</small>
          </button>
        ))}
      </div>
      </header>
      <div className="access-body" id="access-scope-panel" role="tabpanel" aria-labelledby={`access-scope-${selection.scope}`}>
      {archived && <div className="access-archived-notice" role="status">
        <div><strong>Archived organization · view only</strong><p>Learning settings and student records are preserved. Restore this organization to edit access or let members sign in.</p></div>
        <Link className="btn" to="/organizations">Manage organizations →</Link>
      </div>}
      {notice && (
        <div className="access-success" role="status">
          <span>✓</span>
          {notice}
          <button
            type="button"
            aria-label="Dismiss update confirmation"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {workspace.error && !organizations.error && (
        <div className="access-archived-notice" role="status">
          <div><strong>Refresh the learning access view</strong><p>Saved branches are safe. Reload this view before changing access.</p></div>
          <button className="btn" type="button" disabled={workspace.isFetching} onClick={() => void workspace.refetch()}>{workspace.isFetching ? "Refreshing…" : "Retry"}</button>
        </div>
      )}
      <DataState
        pending={
          organizations.isPending ||
          (Boolean(organizationId) && workspace.isPending)
        }
        error={organizations.error || workspace.error}
      >
        {data ? (
          <>
            <div
              className={`access-workspace ${selection.scope !== "organization" ? "has-directory" : ""}`}
            >
              {selection.scope !== "organization" && (
                <aside className="access-directory">
                  <div className="access-directory-head">
                    <h3>{scopeLabels[selection.scope]}</h3>
                    {selection.scope === "branch" && !archived && (
                      <button
                        className="access-add-branch"
                        type="button"
                        onClick={() =>
                          navigate(organizationId, { scope: "branch", id: "" })
                        }
                        disabled={saving}
                      >
                        + Add branch
                      </button>
                    )}
                  </div>
                  <input
                    type="search"
                    aria-label={`Search ${scopeLabels[selection.scope].toLowerCase()}`}
                    placeholder={
                      selection.scope === "student"
                        ? "Search name, ID or email"
                        : "Search branches"
                    }
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {selection.scope === "student" && (
                    <AdminSelect
                      aria-label="Filter students by branch"
                      value={branchFilter}
                      onChange={setBranchFilter}
                      searchable
                      options={[{ value: "", label: "All branches" }, ...data.branches.map(branch => ({ value: branch.code, label: branch.name }))]}
                    />
                  )}
                  <div className="access-directory-items">
                    {selection.scope === "branch"
                      ? filteredBranches.map((branch) => (
                          <button
                            type="button"
                            key={branch.code}
                            className={
                              selection.id === branch.code ? "active" : ""
                            }
                            disabled={saving}
                            onClick={() =>
                              navigate(organizationId, {
                                scope: "branch",
                                id: branch.code,
                              })
                            }
                          >
                            <span className="access-avatar">
                              {branch.code.slice(0, 3)}
                            </span>
                            <span>
                              <strong>{branch.name}</strong>
                              <small>
                                {branch.code} · {branch.studentCount} students
                              </small>
                            </span>
                          </button>
                        ))
                      : filteredStudents.map((student) => (
                          <button
                            type="button"
                            key={student.id}
                            className={
                              selection.id === student.id ? "active" : ""
                            }
                            disabled={saving}
                            onClick={() =>
                              navigate(organizationId, {
                                scope: "student",
                                id: student.id,
                              })
                            }
                          >
                            <span className="access-avatar">
                              {student.name
                                .split(" ")
                                .map((word) => word[0])
                                .slice(0, 2)
                                .join("")}
                            </span>
                            <span>
                              <strong>{student.name}</strong>
                              <small>
                                {student.branchCode || "No branch"} ·{" "}
                                {student.studentId || student.email}
                              </small>
                            </span>
                          </button>
                        ))}
                    {!(
                      selection.scope === "branch"
                        ? filteredBranches
                        : filteredStudents
                    ).length && (
                      <p className="access-directory-empty">
                        {search || branchFilter
                          ? "No matches found."
                          : selection.scope === "branch"
                            ? archived ? "No saved branches in this organization." : "Create a branch to assign a shared learning path."
                            : "Student accounts appear here."}
                      </p>
                    )}
                  </div>
                </aside>
              )}
              {selection.scope === "branch" && !selection.id && !archived ? (
                <CreateBranch key={`${organizationId}-${editorVersion}`} organizationId={organizationId} organizationName={data.organization.name} onDirty={setDirty} onPending={setSaving} onCreated={async branch => {
                  setDirty(false);
                  setNotice(`${branch.name} (${branch.code}) created. It is now available on this organization’s student forms.`);
                  await client.invalidateQueries({ queryKey: ["platform", "access", organizationId], exact: true });
                  void client.invalidateQueries({ queryKey: ["platform", `organization-branches-${organizationId}`], exact: true });
                  void client.invalidateQueries({ queryKey: ["platform", `announcement-audience:${organizationId}`], exact: true });
                  setSaving(false);
                  setSelection({ scope: "branch", id: branch.code });
                  setParams({ organizationId, tab: "branches", branchCode: branch.code }, { replace: true });
                  setEditorVersion(value => value + 1);
                }} />
              ) : canView ? (
                <AccessEditor
                  key={`${organizationId}-${selection.scope}-${selection.id}-${editorVersion}-${archived}`}
                  workspace={data}
                  selection={selection}
                  readOnly={archived}
                  onDirty={setDirty}
                  onPending={setSaving}
                  onSaved={(updated, next) => {
                    client.setQueryData(
                      ["platform", "access", organizationId],
                      updated,
                    );
                    void client.invalidateQueries({
                      queryKey: ["platform", `members-${organizationId}`],
                    });
                    setSelection(next);
                    setDirty(false);
                    setSaving(false);
                    setEditorVersion((value) => value + 1);
                    setNotice(
                      `Access updated for ${next.scope === "organization" ? updated.organization.name : next.scope === "branch" ? `${next.id} branch` : updated.students.find((student) => student.id === next.id)?.name || "this student"}. Student portals will refresh automatically.`,
                    );
                  }}
                />
              ) : (
                <Empty
                  title={
                    selection.scope === "branch" ? "No saved branch selected" : data.students.length
                      ? "Choose a student"
                      : "No students yet"
                  }
                >
                  {archived ? (
                    selection.scope === "branch" ? "Select an existing branch to review its saved settings. New branches can be created after the organization is restored." : "Select a student to review saved access. Student records stay available while this organization is archived."
                  ) : selection.scope === "branch" ? (
                    "Choose a saved branch from the list, or select Add branch to create one."
                  ) : data.students.length ? (
                    "Select a student to review inherited access and add an individual selection."
                  ) : (
                    <>
                      Create student accounts or approve public registrations to start assigning learning.{" "}
                      <Link to={`/members?organizationId=${organizationId}`}>Manage students →</Link>
                    </>
                  )}
                </Empty>
              )}
            </div>
          </>
        ) : (
          !organizations.isPending && (
            <Empty title="Choose an organization">
              Create or select an organization to configure its student
              experience.{" "}
              <Link to="/organizations">Manage organizations →</Link>
            </Empty>
          )
        )}
      </DataState>
      </div>
      {pendingNavigation && (
        <div className="access-dialog-backdrop">
          <section
            className="access-discard-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="access-discard-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setPendingNavigation(null);
              }
              if (event.key === "Tab") {
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  );
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h2 id="access-discard-title">Keep editing your changes?</h2>
            <p>
              Your changes have not been applied. Save your changes before
              switching, or discard this draft.
            </p>
            <div className="actions">
              <button
                autoFocus
                type="button"
                className="btn primary"
                onClick={() => setPendingNavigation(null)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if ("href" in pendingNavigation) {
                    setDirty(false);
                    setPendingNavigation(null);
                    routerNavigate(pendingNavigation.href);
                  } else
                    applyNavigation(
                      pendingNavigation.organizationId,
                      pendingNavigation.selection,
                    );
                }}
              >
                Discard draft
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

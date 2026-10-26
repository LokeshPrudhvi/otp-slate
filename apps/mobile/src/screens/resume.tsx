import { useEffect, useState } from "react";
import { View, Alert, Platform } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { useMutation } from "@tanstack/react-query";
import { usePreventRemove } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import Pdf from "react-native-pdf";
import type { Resume } from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Card,
  Button,
  Field,
  State,
  Chips,
  Notice,
  Icon,
  s,
} from "../components/ui";
import { EmptyFeature } from "../components/learning";
import { usePage, useSession, useFeature } from "../lib/session";
import { api } from "../lib/api";
import {
  normalizeResume,
  newProject,
  newExperience,
  newEducation,
  newCertification,
  type ResumeDraft,
} from "../lib/resume-model";
import { resumeHtml } from "../lib/resume-html";
type Group = "projects" | "experience" | "education" | "certifications";
const groups: {
  id: Group;
  label: string;
  make: () => ResumeDraft[Group][number];
}[] = [
  { id: "projects", label: "Projects", make: newProject },
  { id: "experience", label: "Experience", make: newExperience },
  { id: "education", label: "Education", make: newEducation },
  { id: "certifications", label: "Certifications", make: newCertification },
];
const fieldLabels: Record<string, string> = {
  title: "Title",
  description: "Description",
  url: "Project / credential URL",
  company: "Company",
  institution: "Institution",
  degree: "Degree",
  fieldOfStudy: "Field of study",
  grade: "Grade / CGPA",
  name: "Certificate name",
  issuer: "Issuing organization",
  credentialId: "Credential ID",
};
function MonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}-15T12:00:00`) : new Date();
  const changed = (_: unknown, selected?: Date) => {
    setOpen(false);
    if (selected)
      onChange(
        `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}`,
      );
  };
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <Button
        title={value || "Choose month & year"}
        secondary
        onPress={() => {
          if (Platform.OS === "android")
            DateTimePickerAndroid.open({
              value: date,
              mode: "date",
              onChange: changed,
            });
          else setOpen(true);
        }}
      />
      {open && <DateTimePicker value={date} mode="date" onChange={changed} />}
    </View>
  );
}
export function ResumeScreen() {
  const allowed = useFeature("resume"),
    { me } = useSession(),
    query = usePage<{ data: Resume | null; revision: number }>(
      "student/resume",
      allowed,
    );
  if (!allowed)
    return (
      <Screen back title="Resume builder">
        <EmptyFeature />
      </Screen>
    );
  if (!query.data)
    return (
      <Screen back title="Resume builder">
        <State
          pending={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  return (
    <ResumeEditor
      key={me?.id}
      initial={normalizeResume(query.data.data, me)}
      initialRevision={query.data.revision}
    />
  );
}
function ResumeEditor({
  initial,
  initialRevision,
}: {
  initial: ResumeDraft;
  initialRevision: number;
}) {
  const [allowLeave, setAllowLeave] = useState(false);
  const [draft, setDraft] = useState<ResumeDraft | null>(initial),
    [revision, setRevision] = useState(initialRevision),
    [signature, setSignature] = useState(JSON.stringify(initial)),
    [section, setSection] = useState(""),
    [skill, setSkill] = useState(""),
    [pdf, setPdf] = useState(""),
    [exportError, setExportError] = useState<Error | null>(null),
    [exporting, setExporting] = useState(false);
  const dirty = Boolean(draft && JSON.stringify(draft) !== signature);
  const save = useMutation({
    mutationFn: (input: { data: ResumeDraft; revision: number }) =>
      api<{ revision: number }>("student/resume", "PUT", input),
    onSuccess: (result, input) => {
      setRevision(result.revision);
      setSignature(JSON.stringify(input.data));
    },
  });
  const { mutate: saveDraft, isPending: saving, isError: saveFailed } = save;
  useEffect(() => {
    if (!draft || !dirty || saving || saveFailed) return;
    const timer = setTimeout(() => saveDraft({ data: draft, revision }), 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, revision, saving, saveFailed, saveDraft]);
  usePreventRemove(dirty && !allowLeave, ({ repeat }) =>
    Alert.alert(
      "Unsaved resume changes",
      "Stay here to finish saving, or leave without saving these edits.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            setAllowLeave(true);
            repeat();
          },
        },
      ],
    ),
  );
  const edit = <K extends keyof ResumeDraft>(key: K, value: ResumeDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const exportPdf = async () => {
    if (!draft) return;
    setExportError(null);
    setExporting(true);
    try {
      const file = await Print.printToFileAsync({ html: resumeHtml(draft) });
      setPdf(file.uri);
    } catch (e) {
      setExportError(e as Error);
    } finally {
      setExporting(false);
    }
  };
  if (pdf)
    return (
      <Screen back title="Resume preview" scroll={false} style={{ flex: 1 }}>
        <Pdf
          source={{ uri: pdf }}
          trustAllCerts={false}
          style={{ flex: 1, width: "100%" }}
          onError={(e) => setExportError(new Error(String(e)))}
        />
        {exportError && <Notice error>{exportError.message}</Notice>}
        <Button
          title="Save / share PDF"
          icon="share-2"
          onPress={() =>
            void Sharing.shareAsync(pdf, {
              mimeType: "application/pdf",
              dialogTitle: "Save or share your resume",
            }).catch(setExportError)
          }
        />
        <Button title="Back to editing" secondary onPress={() => setPdf("")} />
      </Screen>
    );
  return (
    <Screen back title="Resume builder">
      {draft && (
        <>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Title>Your story, clearly told.</Title>
          </View>
          <Label muted>
            {save.isPending
              ? "Saving…"
              : save.isError
                ? "Changes not saved"
                : dirty
                  ? "Unsaved changes"
                  : "Saved to your account"}
          </Label>
          {save.error && (
            <>
              <Notice error>
                {save.error.message} Your entries remain here.
              </Notice>
              <Button
                title="Retry save"
                onPress={() => {
                  save.reset();
                  save.mutate({ data: draft, revision });
                }}
              />
            </>
          )}
          <Chips
            value={section}
            onChange={setSection}
            items={[
              { value: "", label: "Overview" },
              { value: "profile", label: "Profile" },
              { value: "skills", label: "Skills" },
              ...groups.map((g) => ({ value: g.id, label: g.label })),
            ]}
          />
          {section === "" ? (
            <>
              <Card>
                <Title>Choose a template</Title>
                <Chips
                  value={draft.template}
                  onChange={(value) => edit("template", value)}
                  items={["classic", "modern", "compact", "serif"].map(
                    (value) => ({
                      value: value as ResumeDraft["template"],
                      label:
                        value === "serif"
                          ? "Editorial"
                          : value[0].toUpperCase() + value.slice(1),
                    }),
                  )}
                />
              </Card>
              <Field
                label="Professional summary"
                multiline
                value={draft.summary}
                maxLength={5000}
                onChangeText={(value) => edit("summary", value)}
              />
              {groups.map((g) => (
                <Card key={g.id} onPress={() => setSection(g.id)} style={s.row}>
                  <Icon name="folder" />
                  <Label style={{ flex: 1, fontWeight: "700" }}>
                    {g.label}
                  </Label>
                  <Label muted>{draft[g.id].length} entries</Label>
                  <Icon name="chevron-right" />
                </Card>
              ))}
            </>
          ) : section === "profile" ? (
            ["name", "title", "email", "phone", "location", "links"].map(
              (key) => (
                <Field
                  key={key}
                  label={
                    {
                      name: "Full name",
                      title: "Professional title",
                      email: "Email address",
                      phone: "Phone number",
                      location: "Location",
                      links: "Professional links",
                    }[key]!
                  }
                  value={draft[key as "name"]}
                  onChangeText={(value) => edit(key as "name", value)}
                />
              ),
            )
          ) : section === "skills" ? (
            <>
              <Field
                label="Add one skill"
                value={skill}
                onChangeText={setSkill}
              />
              <Button
                title="Add skill"
                disabled={!skill.trim() || draft.skills.length >= 200}
                onPress={() => {
                  if (
                    !draft.skills.some(
                      (s) => s.toLowerCase() === skill.trim().toLowerCase(),
                    )
                  )
                    edit("skills", [...draft.skills, skill.trim()]);
                  setSkill("");
                }}
              />
              {draft.skills.map((item, index) => (
                <Card
                  key={`${item}:${index}`}
                  onPress={() =>
                    edit(
                      "skills",
                      draft.skills.filter((_, i) => i !== index),
                    )
                  }
                  style={s.row}
                >
                  <Label style={{ flex: 1 }}>{item}</Label>
                  <Icon name="x" />
                </Card>
              ))}
            </>
          ) : (
            groups
              .filter((g) => g.id === section)
              .map((group) => (
                <View key={group.id} style={{ gap: 15 }}>
                  {draft[group.id].map((entry, index) => (
                    <Card key={entry.id}>
                      <Title>
                        {group.label} {index + 1}
                      </Title>
                      {Object.entries(entry)
                        .filter(
                          ([key]) =>
                            ![
                              "id",
                              "bullets",
                              "current",
                              "startDate",
                              "endDate",
                              "issuedDate",
                            ].includes(key),
                        )
                        .map(([key, value]) => (
                          <Field
                            key={key}
                            label={fieldLabels[key] || key}
                            value={String(value)}
                            multiline={key === "description"}
                            onChangeText={(value) =>
                              edit(
                                group.id,
                                draft[group.id].map((e) =>
                                  e.id === entry.id
                                    ? { ...e, [key]: value }
                                    : e,
                                ) as ResumeDraft[typeof group.id],
                              )
                            }
                          />
                        ))}
                      {["startDate", "endDate", "issuedDate"]
                        .filter((key) => key in entry)
                        .map((key) => (
                          <MonthField
                            key={key}
                            label={
                              key === "startDate"
                                ? "From"
                                : key === "endDate"
                                  ? "To / expected graduation"
                                  : "Issued"
                            }
                            value={
                              (entry as unknown as Record<string, string>)[key]
                            }
                            onChange={(value) =>
                              edit(
                                group.id,
                                draft[group.id].map((e) =>
                                  e.id === entry.id
                                    ? { ...e, [key]: value }
                                    : e,
                                ) as ResumeDraft[typeof group.id],
                              )
                            }
                          />
                        ))}
                      {"current" in entry && (
                        <Button
                          title={
                            entry.current
                              ? "✓ Current / ongoing"
                              : "Mark as current / ongoing"
                          }
                          secondary
                          onPress={() =>
                            edit(
                              group.id,
                              draft[group.id].map((e) =>
                                e.id === entry.id
                                  ? { ...e, current: !entry.current }
                                  : e,
                              ) as ResumeDraft[typeof group.id],
                            )
                          }
                        />
                      )}{" "}
                      {"bullets" in entry && (
                        <>
                          {entry.bullets.map((point, i) => (
                            <View key={i} style={{ gap: 7 }}>
                              <Field
                                label={`Point ${i + 1}`}
                                value={point}
                                multiline
                                onChangeText={(value) =>
                                  edit(
                                    group.id,
                                    draft[group.id].map((e) =>
                                      e.id === entry.id
                                        ? {
                                            ...entry,
                                            bullets: entry.bullets.map(
                                              (p, j) => (j === i ? value : p),
                                            ),
                                          }
                                        : e,
                                    ) as ResumeDraft[typeof group.id],
                                  )
                                }
                              />
                              <Button
                                title="Remove point"
                                secondary
                                onPress={() =>
                                  edit(
                                    group.id,
                                    draft[group.id].map((e) =>
                                      e.id === entry.id
                                        ? {
                                            ...entry,
                                            bullets: entry.bullets.filter(
                                              (_, j) => j !== i,
                                            ),
                                          }
                                        : e,
                                    ) as ResumeDraft[typeof group.id],
                                  )
                                }
                              />
                            </View>
                          ))}
                          <Button
                            title="Add point"
                            secondary
                            disabled={entry.bullets.length >= 50}
                            onPress={() =>
                              edit(
                                group.id,
                                draft[group.id].map((e) =>
                                  e.id === entry.id
                                    ? {
                                        ...entry,
                                        bullets: [...entry.bullets, ""],
                                      }
                                    : e,
                                ) as ResumeDraft[typeof group.id],
                              )
                            }
                          />
                        </>
                      )}
                      <Button
                        title="Remove entry"
                        secondary
                        danger
                        onPress={() =>
                          edit(
                            group.id,
                            draft[group.id].filter(
                              (e) => e.id !== entry.id,
                            ) as ResumeDraft[typeof group.id],
                          )
                        }
                      />
                    </Card>
                  ))}
                  <Button
                    title={`Add ${group.label.toLowerCase()} entry`}
                    disabled={draft[group.id].length >= 100}
                    onPress={() =>
                      edit(group.id, [
                        ...draft[group.id],
                        group.make(),
                      ] as ResumeDraft[typeof group.id])
                    }
                  />
                </View>
              ))
          )}
          {exportError && <Notice error>{exportError.message}</Notice>}
          <Button
            title="Preview & export PDF"
            loading={exporting}
            onPress={() => void exportPdf()}
          />
        </>
      )}
    </Screen>
  );
}

import { useState } from "react";
import { Image, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Pdf from "react-native-pdf";
import Markdown from "react-native-markdown-display";
import type { Job, PlacementResource } from "@slate/contracts";
import {
  Screen,
  Title,
  Label,
  Card,
  Button,
  Field,
  State,
  Chips,
  Badge,
  s,
} from "../components/ui";
import { EmptyFeature } from "../components/learning";
import { usePage, useFeature } from "../lib/session";
import { safeExternalUrl } from "../lib/api";
import { colors } from "../theme";
function Logo({
  url,
  name,
  size = 64,
}: {
  url?: string | null;
  name: string;
  size?: number;
}) {
  return url ? (
    <Image
      source={{ uri: url }}
      accessibilityLabel={`${name} logo`}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        backgroundColor: "#fff",
        borderRadius: 9,
      }}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: "#fff",
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Label style={{ fontSize: size / 2, fontWeight: "700" }}>
        {name.slice(0, 1)}
      </Label>
    </View>
  );
}
function open(value: string) {
  void WebBrowser.openBrowserAsync(safeExternalUrl(value));
}
export function CareersScreen() {
  const jobsAllowed = useFeature("jobs"),
    resumeAllowed = useFeature("resume"),
    [tab, setTab] = useState(jobsAllowed ? "jobs" : "resume"),
    [search, setSearch] = useState("");
  const jobs = usePage<Job[]>("student/jobs", jobsAllowed && tab === "jobs"),
    certs = usePage<PlacementResource[]>(
      "student/placement?kind=certification",
      jobsAllowed && tab === "certifications",
    );
  const items = [
    ...(jobsAllowed
      ? [
          { value: "jobs", label: "Jobs" },
          { value: "certifications", label: "Certifications" },
        ]
      : []),
    ...(resumeAllowed ? [{ value: "resume", label: "Resume" }] : []),
  ];
  return (
    <Screen>
      <Title>Your next opportunity.</Title>
      <Label muted>Explore jobs, earn new skills and tell your story.</Label>
      <Chips
        items={items}
        value={tab}
        onChange={(value) => {
          setTab(value);
          setSearch("");
        }}
      />
      {tab === "resume" ? (
        <Card>
          <Title>Build a resume that feels like you.</Title>
          <Label muted>
            Add your projects, experience, skills and qualifications one detail
            at a time.
          </Label>
          <Button
            title="Open resume builder"
            onPress={() => router.push("/resume")}
          />
        </Card>
      ) : (
        <>
          <Field
            label={
              tab === "jobs" ? "Find an opportunity" : "Find a certification"
            }
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name"
          />
          <State
            pending={tab === "jobs" ? jobs.isPending : certs.isPending}
            error={tab === "jobs" ? jobs.error : certs.error}
            onRetry={() =>
              void (tab === "jobs" ? jobs.refetch() : certs.refetch())
            }
          />
          {tab === "jobs"
            ? jobs.data
                ?.filter((job) =>
                  `${job.company} ${job.title}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((job, index) => (
                  <Card
                    key={job.id}
                    style={{
                      backgroundColor: [
                        colors.amberLight,
                        colors.tealLight,
                        colors.purpleLight,
                      ][index % 3],
                    }}
                    onPress={() => router.push(`/jobs/${job.id}`)}
                  >
                    <View style={[s.row, { justifyContent: "space-between" }]}>
                      <Label muted style={{ fontSize: 12 }}>
                        Posted {new Date(job.postedAt).toLocaleDateString()}
                      </Label>
                      <Logo url={job.companyLogoUrl} name={job.company} />
                    </View>
                    <Label>{job.company}</Label>
                    <Title>{job.title}</Title>
                    <Label muted>
                      {job.description.slice(0, 140)}
                      {job.description.length > 140 ? "…" : ""}
                    </Label>
                    <Button
                      title="View opportunity"
                      secondary
                      onPress={() => router.push(`/jobs/${job.id}`)}
                    />
                  </Card>
                ))
            : certs.data
                ?.filter((c) =>
                  c.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((c) => (
                  <Card key={c.id}>
                    <Logo url={c.logoUrl} name={c.provider} />
                    <Badge tone="purple">{c.provider}</Badge>
                    <Title>{c.title}</Title>
                    <Label muted>{c.description}</Label>
                    <Button
                      title="View course"
                      secondary
                      icon="external-link"
                      onPress={() => open(c.url)}
                    />
                  </Card>
                ))}
        </>
      )}
    </Screen>
  );
}
export function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<Job[]>("student/jobs"),
    job = query.data?.find((j) => j.id === id);
  return (
    <Screen back title="Job opportunity">
      <State
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={query.data && !job ? "Opportunity unavailable" : undefined}
      />
      {job && (
        <>
          <Logo url={job.companyLogoUrl} name={job.company} size={88} />
          <Label>{job.company}</Label>
          <Title>{job.title}</Title>
          <Label muted>
            Posted {new Date(job.postedAt).toLocaleDateString()}
          </Label>
          <Label>{job.description}</Label>
          <Button
            title="Apply on company website"
            icon="external-link"
            onPress={() => open(job.url)}
          />
        </>
      )}
    </Screen>
  );
}
export function PyqScreen() {
  const allowed = useFeature("pyq"),
    query = usePage<PlacementResource[]>(
      "student/placement?kind=company",
      allowed,
    ),
    [search, setSearch] = useState("");
  return (
    <Screen back title="Company PYQ">
      <Title>Prepare for your target company.</Title>
      {!allowed ? (
        <EmptyFeature />
      ) : (
        <>
          <Field
            label="Find a company"
            value={search}
            onChangeText={setSearch}
          />
          <State
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {query.data
              ?.filter((c) =>
                c.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((c) => (
                <Card
                  key={c.id}
                  onPress={() => router.push(`/pyq/${c.id}`)}
                  style={{
                    width: "48%",
                    alignItems: "center",
                    paddingVertical: 25,
                  }}
                >
                  <Logo url={c.logoUrl} name={c.title} size={94} />
                  <Label style={{ fontWeight: "700", textAlign: "center" }}>
                    {c.title}
                  </Label>
                </Card>
              ))}
          </View>
        </>
      )}
    </Screen>
  );
}
export function CompanyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = usePage<PlacementResource[]>("student/placement?kind=company"),
    company = query.data?.find((c) => c.id === id),
    [tab, setTab] = useState("hiring"),
    [answer, setAnswer] = useState<number | null>(null);
  return (
    <Screen back title={company?.title || "Company preparation"}>
      <State
        pending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {company && (
        <>
          <Logo url={company.logoUrl} name={company.title} size={95} />
          <Title>{company.title}</Title>
          <Chips
            value={tab}
            onChange={setTab}
            items={[
              { value: "hiring", label: "Hiring procedure" },
              { value: "papers", label: "Papers" },
              { value: "practice", label: "Practice" },
            ]}
          />
          {tab === "hiring" ? (
            <Markdown>{company.hiringProcedure}</Markdown>
          ) : tab === "papers" ? (
            company.papers.map((paper, index) => (
              <Card key={index}>
                <Title>{paper.title}</Title>
                <Button
                  title="Open paper"
                  icon="file-text"
                  onPress={() =>
                    router.push({
                      pathname: "/document",
                      params: {
                        url: safeExternalUrl(paper.url),
                        title: paper.title,
                      },
                    })
                  }
                />
              </Card>
            ))
          ) : (
            company.practiceQuestions.map((q, index) => (
              <Card key={index}>
                <Label style={{ fontWeight: "700" }}>
                  {index + 1}. {q.question}
                </Label>
                <Button
                  title={answer === index ? "Hide answer" : "Show answer"}
                  secondary
                  onPress={() => setAnswer(answer === index ? null : index)}
                />
                {answer === index && <Label muted>{q.answer}</Label>}
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
export function DocumentScreen() {
  const { url, title } = useLocalSearchParams<{
      url: string;
      title?: string;
    }>(),
    [error, setError] = useState<Error | null>(null);
  return (
    <Screen
      back
      title={title || "Document"}
      scroll={false}
      style={{ flex: 1, padding: 0 }}
    >
      {error ? (
        <State error={error} onRetry={() => setError(null)} />
      ) : (
        <Pdf
          source={{ uri: safeExternalUrl(url), cache: false }}
          trustAllCerts={false}
          onError={(e) => setError(new Error(String(e)))}
          style={{ flex: 1, width: "100%" }}
        />
      )}
    </Screen>
  );
}

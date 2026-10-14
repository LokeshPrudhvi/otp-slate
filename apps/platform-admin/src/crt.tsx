import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { crtSubjects, type CrtTopic } from "@slate/contracts";
import { DataState, Empty, Field, Icon, useData } from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import { AdminPagination } from "./shell";
import { CrtAssignmentsPanel } from "./crt-assignments";
import { CrtPracticeBank } from "./crt-practice";
import "./crt.css";

export function CrtAdmin() {
  const [params, setParams] = useSearchParams();
  const tab = ["assignments", "practice"].includes(params.get("tab") || "") ? params.get("tab")! : "topics";
  const subjects = crtSubjects;
  const [subject, setSubject] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const topics = useData<CrtTopic[]>("crt:topics", "platform/crt/topics");
  const rows = (topics.data || []).filter(topic => (!subject || topic.subjectId === subject) && (!status || topic.status === status) && `${topic.title} ${topic.description}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 12)));
  useEffect(() => { setPage(1); }, [subject, search, status]);
  return <AdminPage title="CRT curriculum" description="Four focused subjects. Shared lessons, purposeful practice and branch-specific learning." className="crt-admin" action={<Link className="btn primary" to="/crt/new">+ Create topic</Link>}>
    <nav className="crt-admin-tabs" aria-label="CRT management">
      {[["topics", "Topic library", "book"], ["assignments", "Branch assignments", "users"], ["practice", "Practice bank", "exam"]].map(([id, name, icon]) => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setParams(current => { const next = new URLSearchParams(current); next.set("tab", id); return next; })}><Icon name={icon} />{name}</button>)}
    </nav>
    {tab === "assignments" ? <CrtAssignmentsPanel topics={topics.data || []} topicsPending={topics.isPending} topicsError={topics.error} /> : tab === "practice" ? <CrtPracticeBank topics={topics.data || []} topicsPending={topics.isPending} topicsError={topics.error} /> : <>
      <div className="crt-subject-overview">{subjects.map((item, index) => <button className={subject === item.id ? "selected" : ""} type="button" key={item.id} aria-pressed={subject === item.id} onClick={() => setSubject(subject === item.id ? "" : item.id)}><span className="crt-subject-number">0{index + 1}</span><strong>{item.name}</strong><small>{(topics.data || []).filter(topic => topic.subjectId === item.id).length} topics</small></button>)}</div>
      <section className="panel"><div className="panel-head"><div><h2>Topic library</h2><p className="crt-panel-description">Each topic combines a reading PDF with an assessment.</p></div><span className="admin-count">{topics.data?.length || 0} topics</span></div><div className="panel-body">
        <div className="crt-admin-filters"><Field label="Search topics"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a topic by name" /></Field><Field label="Status"><AdminSelect aria-label="Topic status" value={status} onChange={setStatus} options={[{ value: "", label: "All topics" }, { value: "draft", label: "Drafts" }, { value: "published", label: "Published" }]} /></Field>{subject && <button className="text-button" type="button" onClick={() => setSubject("")}>Clear subject filter</button>}</div>
        <DataState pending={topics.isPending} error={topics.error}>
          {rows.length ? <><div className="crt-admin-topic-grid">{rows.slice((currentPage - 1) * 12, currentPage * 12).map(topic => <Link className="crt-admin-topic-card" to={`/crt/topics/${topic.id}`} key={topic.id}>
            <div className="crt-topic-card-meta"><span className={`badge ${topic.status === "published" ? "green" : ""}`}>{topic.status === "published" ? `Published v${topic.version}` : topic.version ? "Unpublished changes" : "Draft"}</span><span>{crtSubjects.find(item => item.id === topic.subjectId)?.name}</span></div>
            <h3>{topic.title}</h3><p>{topic.description || "Add a description to introduce this topic."}</p>
            <div className="crt-topic-card-footer"><span>{topic.questions.length} MCQs · Pass {topic.passingScore}%</span><strong>Edit topic →</strong></div>
          </Link>)}</div><AdminPagination page={currentPage} total={rows.length} size={12} onChange={setPage} /></> : <Empty title={topics.data?.length ? "No matching topics" : "Build your CRT curriculum"} action={!topics.data?.length && <Link className="btn primary" to="/crt/new">Create your first topic</Link>}>{topics.data?.length ? "Try a different search, subject or status." : "Start with a topic in any of the four subjects, then add its PDF and assessment."}</Empty>}
        </DataState>
      </div></section>
    </>}
  </AdminPage>;
}

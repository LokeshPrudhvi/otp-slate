import { Route, Routes, useParams } from "react-router-dom";
import type { Analytics } from "@slate/contracts";
import {
  DataState,
  Login,
  NotFound,
  Onboarding,
  Protected,
  ResetPassword,
  useData,
} from "@slate/ui";
import { OrganizationWorkspace } from "./workspace";
import { OrganizationOverview, OrganizationLearning } from "./analytics";
import { OrganizationRankings } from "./rankings";
import { OrganizationStudents, OrganizationStudentDetail } from "./students";

function AnalyticsPage({
  page,
}: {
  page: "overview" | "learning" | "rankings" | "students" | "detail";
}) {
  const data = useData<Analytics>("analytics", "organization/analytics"),
    { id } = useParams();
  return (
    <DataState pending={data.isPending} error={data.error}>
      {data.data && (
        <>
          {page === "overview" ? (
            <OrganizationOverview data={data.data} />
          ) : page === "learning" ? (
            <OrganizationLearning data={data.data} />
          ) : page === "rankings" ? (
            <OrganizationRankings data={data.data} />
          ) : page === "students" ? (
            <OrganizationStudents data={data.data} />
          ) : (
            <OrganizationStudentDetail data={data.data} id={id || ""} />
          )}
        </>
      )}
    </DataState>
  );
}
export function OrganizationRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<OrganizationWorkspace />}>
          <Route index element={<AnalyticsPage page="overview" />} />
          <Route path="students" element={<AnalyticsPage page="students" />} />
          <Route
            path="students/:id"
            element={<AnalyticsPage page="detail" />}
          />
          <Route path="learning" element={<AnalyticsPage page="learning" />} />
          <Route path="rankings" element={<AnalyticsPage page="rankings" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

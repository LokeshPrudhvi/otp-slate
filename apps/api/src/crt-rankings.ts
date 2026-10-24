import { ForbiddenException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Ranking } from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import { scoped } from "./database.js";

export async function crtRankings(
  service: SlateService,
  actor: Actor,
  mode: "latest" | "overall",
): Promise<Ranking[]> {
  if (actor.role !== "student" || !actor.organizationId)
    throw new ForbiddenException();
  service.feature(actor, "rankings");
  service.feature(actor, "crt");
  // Rankings need peer aggregates. Elevation is confined to this read-only SELECT;
  // both the attempt and member sets are explicitly bound to the authenticated organization.
  return scoped(
    service.db,
    {
      platform: true,
      organizationId: actor.organizationId,
      authId: actor.authId,
    },
    async (tx) => {
      const result = await tx.execute(sql`
   WITH scored AS (
    SELECT a.id,a.member_id,a.topic_id,a.submitted_at,(a.result->>'score')::numeric AS score
    FROM crt_attempts a JOIN members m ON m.id=a.member_id AND m.org_id=a.org_id
    WHERE a.org_id=${actor.organizationId}::uuid AND m.org_id=${actor.organizationId}::uuid
     AND m.role='student' AND m.status='active' AND a.kind='topic' AND a.submitted_at IS NOT NULL
     AND a.result IS NOT NULL AND (a.result->>'score')::numeric BETWEEN 0 AND 100
   ), topic_best AS (SELECT member_id,topic_id,max(score) score FROM scored GROUP BY member_id,topic_id),
   overall AS (SELECT member_id,round(avg(score),1) score FROM topic_best GROUP BY member_id),
   latest AS (SELECT DISTINCT ON (member_id) member_id,score FROM scored ORDER BY member_id,submitted_at DESC,id DESC)
   SELECT m.id,u.name,${mode === "latest" ? sql`l.score` : sql`o.score`} AS points
   FROM members m JOIN auth_user u ON u.id=m.auth_user_id
   LEFT JOIN latest l ON l.member_id=m.id LEFT JOIN overall o ON o.member_id=m.id
   WHERE m.org_id=${actor.organizationId}::uuid AND m.role='student' AND m.status='active'
   ORDER BY points DESC NULLS LAST,u.name,m.id
  `);
      let rank = 0,
        previous: number | undefined;
      return result.rows.map((row, index) => {
        const points = row.points == null ? undefined : Number(row.points);
        if (points !== undefined && points !== previous) rank = index + 1;
        previous = points;
        return {
          id: String(row.id),
          name: String(row.name),
          ...(points === undefined ? {} : { points, rank }),
        };
      });
    },
  );
}

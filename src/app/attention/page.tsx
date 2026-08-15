import Link from "next/link";
import { getItemsNeedingAttention } from "@/domain/attention/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { DecisionActions } from "@/components/DecisionActions";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { QuickViewLink } from "@/components/QuickViewLink";

export const dynamic = "force-dynamic";

const RISK_LABEL: Record<string, string> = { HIGH: "High", CRITICAL: "Critical" };

function canAct(clientId: string, memberships: { clientId: string; role: string }[], isOrgAdmin: boolean) {
  if (isOrgAdmin) return true;
  const membership = memberships.find((m) => m.clientId === clientId);
  return !!membership && (WRITE_ROLES as string[]).includes(membership.role);
}

function isOverdue(date: Date | null, now: number) {
  return !!date && date.getTime() < now;
}

function formatDate(date: Date | null) {
  if (!date) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function AttentionCenterPage() {
  const ctx = await requireAuthContext();
  const { decisions, blockers, risks, deadlines, approvalGates, pausedClarifications, summary, now } =
    await getItemsNeedingAttention(ctx);

  const allClear =
    summary.decisions === 0 &&
    summary.blockers === 0 &&
    summary.risks === 0 &&
    summary.deadlines === 0 &&
    summary.approvalGates === 0 &&
    summary.pausedClarifications === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Attention Center</h1>
        <p className="text-sm opacity-60">Everything needing a human decision, in one place — with the reason always visible.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <SummaryCard label="Decisions" count={summary.decisions} href="#decisions" />
        <SummaryCard label="Blockers" count={summary.blockers} href="#blockers" />
        <SummaryCard label="Risks" count={summary.risks} href="#risks" />
        <SummaryCard label="Deadlines" count={summary.deadlines} href="#deadlines" />
        <SummaryCard label="Approval Gates" count={summary.approvalGates} href="#approval-gates" />
        <SummaryCard label="Clarifications" count={summary.pausedClarifications} href="#clarifications" />
      </div>

      {allClear && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">All clear — nothing needs your attention.</p>
        </div>
      )}

      {summary.decisions > 0 && (
        <Section id="decisions" title="Decisions" count={summary.decisions}>
          {decisions.map((d) => {
            const overdue = isOverdue(d.deadline, now);
            return (
              <Row key={d.id}>
                <p className="font-medium">{d.question}</p>
                <RowMeta workItem={d.workItem} />
                <p className="text-sm opacity-70">{d.reason}</p>
                {d.aiRecommendation && (
                  <p className="text-xs opacity-60">
                    AI recommends: {d.aiRecommendation}
                    {d.aiConfidence !== null && ` (${d.aiConfidence.toString()}% confidence)`}
                  </p>
                )}
                {d.deadline && (
                  <p className={`text-xs ${overdue ? "text-red-500 font-medium" : "opacity-50"}`}>
                    Deadline: {formatDate(d.deadline)} {overdue && "(overdue)"}
                  </p>
                )}
                <QuickViewLink workItemId={d.workItem.id} className="text-xs underline opacity-70 w-fit">
                  Quick View
                </QuickViewLink>
                {canAct(d.workItem.projectId, ctx.memberships, ctx.isOrgAdmin) && <DecisionActions decisionId={d.id} />}
              </Row>
            );
          })}
        </Section>
      )}

      {summary.blockers > 0 && (
        <Section id="blockers" title="Blockers" count={summary.blockers}>
          {blockers.map((b) => (
            <Row key={b.id}>
              <p className="font-medium">Blocked — {b.reason}</p>
              <RowMeta workItem={b.blockingItem} />
              <p className="text-xs opacity-60">Owner: {b.owner.name ?? b.owner.email}</p>
              <p className="text-sm opacity-70">Required action: {b.requiredAction}</p>
              {b.impact && <p className="text-xs opacity-50">Impact: {b.impact}</p>}
              <QuickViewLink workItemId={b.blockingItem.id} className="text-xs underline opacity-70 w-fit">
                Quick View
              </QuickViewLink>
              {(canAct(b.blockingItem.projectId, ctx.memberships, ctx.isOrgAdmin) || b.ownerId === ctx.userId) && (
                <ResolveBlockerButton blockerId={b.id} />
              )}
            </Row>
          ))}
        </Section>
      )}

      {summary.risks > 0 && (
        <Section id="risks" title="Risks" count={summary.risks}>
          {risks.map((item) => (
            <Row key={item.id}>
              <span className="inline-block w-fit rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                {RISK_LABEL[item.risk] ?? item.risk}
              </span>
              <RowMeta workItem={item} />
              <WorkItemLink workItemId={item.id} />
            </Row>
          ))}
        </Section>
      )}

      {summary.deadlines > 0 && (
        <Section id="deadlines" title="Deadlines" count={summary.deadlines}>
          {deadlines.map((item) => {
            const dueSoon = item.dueDate && item.dueDate.getTime() - now < 24 * 60 * 60 * 1000;
            return (
              <Row key={item.id}>
                <p className={`font-medium ${dueSoon ? "text-red-500" : ""}`}>Due {formatDate(item.dueDate)}</p>
                <RowMeta workItem={item} />
                <WorkItemLink workItemId={item.id} />
              </Row>
            );
          })}
        </Section>
      )}

      {summary.approvalGates > 0 && (
        <Section id="approval-gates" title="Approval Gates" count={summary.approvalGates}>
          {approvalGates.map((item) => (
            <Row key={item.id}>
              <p className="font-medium">Awaiting approval</p>
              <RowMeta workItem={item} />
              <WorkItemLink workItemId={item.id} />
            </Row>
          ))}
        </Section>
      )}

      {summary.pausedClarifications > 0 && (
        <Section id="clarifications" title="Clarifications" count={summary.pausedClarifications}>
          {pausedClarifications.map((stage) => (
            <Row key={stage.id}>
              <p className="font-medium">
                {stage.clarifyQuestions.length} question{stage.clarifyQuestions.length === 1 ? "" : "s"} outstanding on the{" "}
                {stage.type} stage
              </p>
              <RowMeta workItem={stage.pipeline.workItem} />
              <ul className="text-xs opacity-70">
                {stage.clarifyQuestions.map((q) => (
                  <li key={q.id}>{q.question}</li>
                ))}
              </ul>
              <Link href={`/pipelines/${stage.pipelineId}`} className="text-xs underline opacity-70 w-fit">
                Answer on the pipeline page
              </Link>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function SummaryCard({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-black/25 dark:hover:border-white/30"
    >
      <p className="text-2xl font-semibold">{count}</p>
      <p className="text-xs opacity-60">{label}</p>
    </Link>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-medium">
        {title} <span className="opacity-50">({count})</span>
      </h2>
      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
        {children}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5 px-4 py-3">{children}</div>;
}

function RowMeta({ workItem }: { workItem: { title: string; type: string; project?: { name: string } } }) {
  return (
    <p className="text-xs opacity-60">
      {workItem.title} · {workItem.type}
      {workItem.project && ` · ${workItem.project.name}`}
    </p>
  );
}

function WorkItemLink({ workItemId }: { workItemId: string }) {
  return (
    <span className="flex gap-3">
      <Link href={`/work-items/${workItemId}/360`} className="text-xs underline opacity-70">
        View work item
      </Link>
      <QuickViewLink workItemId={workItemId} className="text-xs underline opacity-70">
        Quick View
      </QuickViewLink>
    </span>
  );
}

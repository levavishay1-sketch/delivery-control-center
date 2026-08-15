import Link from "next/link";
import { getItemsNeedingAttention } from "@/domain/attention/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { DecisionActions } from "@/components/DecisionActions";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { QuickViewLink } from "@/components/QuickViewLink";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RowList } from "@/components/ui/Row";
import { CheckCircle2 } from "lucide-react";

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
  const { decisions, blockers, risks, deadlines, approvalGates, pausedClarifications, syncConflicts, summary, now } =
    await getItemsNeedingAttention(ctx);

  const allClear =
    summary.decisions === 0 &&
    summary.blockers === 0 &&
    summary.risks === 0 &&
    summary.deadlines === 0 &&
    summary.approvalGates === 0 &&
    summary.pausedClarifications === 0 &&
    summary.syncConflicts === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Attention Center</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Everything needing a human decision, in one place — with the reason always visible.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Decisions" count={summary.decisions} href="#decisions" />
        <SummaryChip label="Blockers" count={summary.blockers} href="#blockers" />
        <SummaryChip label="Risks" count={summary.risks} href="#risks" />
        <SummaryChip label="Deadlines" count={summary.deadlines} href="#deadlines" />
        <SummaryChip label="Approval Gates" count={summary.approvalGates} href="#approval-gates" />
        <SummaryChip label="Clarifications" count={summary.pausedClarifications} href="#clarifications" />
        <SummaryChip label="Sync Conflicts" count={summary.syncConflicts} href="#sync-conflicts" />
      </div>

      {allClear && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-status-healthy-bg p-6 text-status-healthy">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-medium">All clear — nothing needs your attention.</span>
        </div>
      )}

      {summary.decisions > 0 && (
        <Section id="decisions" title="Decisions" count={summary.decisions}>
          {decisions.map((d) => {
            const overdue = isOverdue(d.deadline, now);
            return (
              <Row key={d.id}>
                <StatusBadge tone="warning" label="Decision required" reason={d.question} />
                <RowMeta workItem={d.workItem} />
                <p className="text-sm text-neutral-500 dark:text-neutral-400">{d.reason}</p>
                {d.aiRecommendation && (
                  <p className="flex items-center gap-1 text-xs text-status-ai">
                    AI recommends: {d.aiRecommendation}
                    {d.aiConfidence !== null && ` (${d.aiConfidence.toString()}% confidence)`}
                  </p>
                )}
                {d.deadline && (
                  <p className={`text-xs ${overdue ? "font-medium text-status-critical" : "text-neutral-400"}`}>
                    Deadline: {formatDate(d.deadline)} {overdue && "(overdue)"}
                  </p>
                )}
                <QuickViewLink workItemId={d.workItem.id} className="w-fit text-xs text-accent hover:underline">
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
              <StatusBadge tone="critical" label="Blocked" reason={b.reason} />
              <RowMeta workItem={b.blockingItem} />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Owner: {b.owner.name ?? b.owner.email}</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Required action: {b.requiredAction}</p>
              {b.impact && <p className="text-xs text-neutral-400">Impact: {b.impact}</p>}
              <QuickViewLink workItemId={b.blockingItem.id} className="w-fit text-xs text-accent hover:underline">
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
              <StatusBadge
                tone="critical"
                label={`${RISK_LABEL[item.risk] ?? item.risk} risk`}
                reason={`${item.title} is flagged ${(RISK_LABEL[item.risk] ?? item.risk).toLowerCase()} risk`}
              />
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
                <StatusBadge
                  tone={dueSoon ? "critical" : "warning"}
                  label={`Due ${formatDate(item.dueDate)}`}
                  reason={dueSoon ? "Due within 24 hours" : "Upcoming deadline"}
                />
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
              <StatusBadge tone="active" label="Awaiting approval" reason="This stage is waiting on a human gate approval" />
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
              <StatusBadge
                tone="warning"
                label="Clarification needed"
                reason={`${stage.clarifyQuestions.length} question${stage.clarifyQuestions.length === 1 ? "" : "s"} outstanding on the ${stage.type} stage`}
              />
              <RowMeta workItem={stage.pipeline.workItem} />
              <ul className="text-xs text-neutral-500 dark:text-neutral-400">
                {stage.clarifyQuestions.map((q) => (
                  <li key={q.id}>{q.question}</li>
                ))}
              </ul>
              <Link href={`/pipelines/${stage.pipelineId}`} className="w-fit text-xs text-accent hover:underline">
                Answer on the pipeline page
              </Link>
            </Row>
          ))}
        </Section>
      )}

      {summary.syncConflicts > 0 && (
        <Section id="sync-conflicts" title="Sync Conflicts" count={summary.syncConflicts}>
          {syncConflicts.map((conflict) => (
            <Row key={conflict.id}>
              <StatusBadge
                tone="warning"
                label="Sync conflict"
                reason={`A sync would overwrite a manually-edited "${conflict.field}" with a different value`}
              />
              <RowMeta workItem={conflict.workItem} />
              <Link
                href={`/projects/${conflict.workItem.projectId}/settings`}
                className="w-fit text-xs text-accent hover:underline"
              >
                Review on the project settings page
              </Link>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function SummaryChip({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-full border border-border-hairline bg-surface px-3 py-1.5 text-sm hover:border-neutral-400 dark:hover:border-neutral-500"
    >
      <span className="font-semibold">{count}</span>
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
    </Link>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-medium">
        {title} <span className="text-neutral-400">({count})</span>
      </h2>
      <RowList>{children}</RowList>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5 px-4 py-3">{children}</div>;
}

function RowMeta({ workItem }: { workItem: { title: string; type: string; project?: { name: string } } }) {
  return (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
      {workItem.title} · {workItem.type}
      {workItem.project && ` · ${workItem.project.name}`}
    </p>
  );
}

function WorkItemLink({ workItemId }: { workItemId: string }) {
  return (
    <span className="flex gap-3">
      <Link href={`/work-items/${workItemId}/360`} className="text-xs text-accent hover:underline">
        View work item
      </Link>
      <QuickViewLink workItemId={workItemId} className="text-xs text-accent hover:underline">
        Quick View
      </QuickViewLink>
    </span>
  );
}

import Link from "next/link";
import { getItemsNeedingAttention } from "@/domain/attention/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { WRITE_ROLES } from "@/domain/shared/authz";
import { DecisionActions } from "@/components/DecisionActions";
import { ResolveBlockerButton } from "@/components/ResolveBlockerButton";
import { QuickViewLink } from "@/components/QuickViewLink";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RowList } from "@/components/ui/Row";
import { StatTile } from "@/components/ui/StatTile";
import { CheckCircle2 } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatMessage, formatDate as formatDateIntl, pluralize } from "@/lib/i18n/format";
import type { Translations } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

function canAct(clientId: string, memberships: { clientId: string; role: string }[], isOrgAdmin: boolean) {
  if (isOrgAdmin) return true;
  const membership = memberships.find((m) => m.clientId === clientId);
  return !!membership && (WRITE_ROLES as string[]).includes(membership.role);
}

function isOverdue(date: Date | null, now: number) {
  return !!date && date.getTime() < now;
}

function formatDate(date: Date | null, locale: Locale) {
  if (!date) return null;
  return formatDateIntl(date, locale);
}

export default async function AttentionCenterPage() {
  const ctx = await requireAuthContext();
  const locale = await getServerLocale();
  const t = getDictionary(locale);
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
      <div className="hero-mesh flex flex-col gap-4 rounded-card p-4 -m-4">
        <div>
          <h1 className="text-xl font-semibold">{t.attentionCenter.heading}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t.attentionCenter.subtitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile tone="warning" count={summary.decisions} label={t.common.decisions} href="#decisions" delayMs={0} />
          <StatTile tone="critical" count={summary.blockers} label={t.common.blockers} href="#blockers" delayMs={40} />
          <StatTile tone="critical" count={summary.risks} label={t.common.risks} href="#risks" delayMs={80} />
          <StatTile tone="warning" count={summary.deadlines} label={t.common.deadlines} href="#deadlines" delayMs={120} />
          <StatTile tone="active" count={summary.approvalGates} label={t.attentionCenter.approvalGates} href="#approval-gates" delayMs={160} />
          <StatTile tone="warning" count={summary.pausedClarifications} label={t.attentionCenter.clarifications} href="#clarifications" delayMs={200} />
          <StatTile tone="warning" count={summary.syncConflicts} label={t.attentionCenter.syncConflicts} href="#sync-conflicts" delayMs={240} />
        </div>
      </div>

      {allClear && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-status-healthy-bg p-6 text-status-healthy">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-medium">{t.attentionCenter.allClear}</span>
        </div>
      )}

      {summary.decisions > 0 && (
        <Section id="decisions" title={t.attentionCenter.decisionsGroupTitle} count={summary.decisions}>
          {decisions.map((d) => {
            const overdue = isOverdue(d.deadline, now);
            return (
              <Row key={d.id}>
                <StatusBadge tone="warning" label={t.attentionCenter.decisionRequired} reason={d.question} />
                <RowMeta workItem={d.workItem} />
                <p className="text-sm text-neutral-500 dark:text-neutral-400">{d.reason}</p>
                {d.aiRecommendation && (
                  <p className="flex items-center gap-1 text-xs text-status-ai">
                    {formatMessage(t.attentionCenter.aiRecommends, { recommendation: d.aiRecommendation })}
                    {d.aiConfidence !== null && formatMessage(t.attentionCenter.aiConfidence, { confidence: d.aiConfidence.toString() })}
                  </p>
                )}
                {d.deadline && (
                  <p className={`text-xs ${overdue ? "font-medium text-status-critical" : "text-neutral-400"}`}>
                    {formatMessage(t.attentionCenter.deadlineLabel, { date: formatDate(d.deadline, locale) ?? "" })}{" "}
                    {overdue && t.attentionCenter.overdue}
                  </p>
                )}
                <QuickViewLink workItemId={d.workItem.id} className="w-fit text-xs text-accent hover:underline">
                  {t.common.quickView}
                </QuickViewLink>
                {canAct(d.workItem.projectId, ctx.memberships, ctx.isOrgAdmin) && <DecisionActions decisionId={d.id} />}
              </Row>
            );
          })}
        </Section>
      )}

      {summary.blockers > 0 && (
        <Section id="blockers" title={t.attentionCenter.blockersGroupTitle} count={summary.blockers}>
          {blockers.map((b) => (
            <Row key={b.id}>
              <StatusBadge tone="critical" label={t.attentionCenter.blocked} reason={b.reason} />
              <RowMeta workItem={b.blockingItem} />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {formatMessage(t.common.ownerLabel, { name: b.owner.name ?? b.owner.email })}
              </p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {formatMessage(t.common.requiredActionLabel, { action: b.requiredAction })}
              </p>
              {b.impact && <p className="text-xs text-neutral-400">{formatMessage(t.attentionCenter.impactLabel, { impact: b.impact })}</p>}
              <QuickViewLink workItemId={b.blockingItem.id} className="w-fit text-xs text-accent hover:underline">
                {t.common.quickView}
              </QuickViewLink>
              {(canAct(b.blockingItem.projectId, ctx.memberships, ctx.isOrgAdmin) || b.ownerId === ctx.userId) && (
                <ResolveBlockerButton blockerId={b.id} />
              )}
            </Row>
          ))}
        </Section>
      )}

      {summary.risks > 0 && (
        <Section id="risks" title={t.attentionCenter.risksGroupTitle} count={summary.risks}>
          {risks.map((item) => {
            const riskLabel = item.risk === "HIGH" ? t.attentionCenter.riskHigh : item.risk === "CRITICAL" ? t.attentionCenter.riskCritical : item.risk;
            return (
              <Row key={item.id}>
                <StatusBadge
                  tone="critical"
                  label={formatMessage(t.attentionCenter.riskLabelSuffix, { level: riskLabel })}
                  reason={formatMessage(t.attentionCenter.riskReason, { title: item.title, level: riskLabel.toLowerCase() })}
                />
                <RowMeta workItem={item} />
                <WorkItemLink workItemId={item.id} t={t} />
              </Row>
            );
          })}
        </Section>
      )}

      {summary.deadlines > 0 && (
        <Section id="deadlines" title={t.attentionCenter.deadlinesGroupTitle} count={summary.deadlines}>
          {deadlines.map((item) => {
            const dueSoon = item.dueDate && item.dueDate.getTime() - now < 24 * 60 * 60 * 1000;
            return (
              <Row key={item.id}>
                <StatusBadge
                  tone={dueSoon ? "critical" : "warning"}
                  label={formatMessage(t.attentionCenter.dueLabel, { date: formatDate(item.dueDate, locale) ?? "" })}
                  reason={dueSoon ? t.attentionCenter.dueSoonReason : t.attentionCenter.upcomingDeadlineReason}
                />
                <RowMeta workItem={item} />
                <WorkItemLink workItemId={item.id} t={t} />
              </Row>
            );
          })}
        </Section>
      )}

      {summary.approvalGates > 0 && (
        <Section id="approval-gates" title={t.attentionCenter.approvalGatesGroupTitle} count={summary.approvalGates}>
          {approvalGates.map((item) => (
            <Row key={item.id}>
              <StatusBadge tone="active" label={t.attentionCenter.awaitingApproval} reason={t.attentionCenter.awaitingApprovalReason} />
              <RowMeta workItem={item} />
              <WorkItemLink workItemId={item.id} t={t} />
            </Row>
          ))}
        </Section>
      )}

      {summary.pausedClarifications > 0 && (
        <Section id="clarifications" title={t.attentionCenter.clarificationsGroupTitle} count={summary.pausedClarifications}>
          {pausedClarifications.map((stage) => (
            <Row key={stage.id}>
              <StatusBadge
                tone="warning"
                label={t.attentionCenter.clarificationNeeded}
                reason={pluralize(locale, stage.clarifyQuestions.length, t.attentionCenter.questionsOutstanding, { stage: stage.type })}
              />
              <RowMeta workItem={stage.pipeline.workItem} />
              <ul className="text-xs text-neutral-500 dark:text-neutral-400">
                {stage.clarifyQuestions.map((q) => (
                  <li key={q.id}>{q.question}</li>
                ))}
              </ul>
              <Link href={`/pipelines/${stage.pipelineId}`} className="w-fit text-xs text-accent hover:underline">
                {t.attentionCenter.answerOnPipeline}
              </Link>
            </Row>
          ))}
        </Section>
      )}

      {summary.syncConflicts > 0 && (
        <Section id="sync-conflicts" title={t.attentionCenter.syncConflictsGroupTitle} count={summary.syncConflicts}>
          {syncConflicts.map((conflict) => (
            <Row key={conflict.id}>
              <StatusBadge
                tone="warning"
                label={t.attentionCenter.syncConflict}
                reason={formatMessage(t.attentionCenter.syncConflictReason, { field: conflict.field })}
              />
              <RowMeta workItem={conflict.workItem} />
              <Link
                href={`/projects/${conflict.workItem.projectId}/settings`}
                className="w-fit text-xs text-accent hover:underline"
              >
                {t.attentionCenter.reviewOnSettings}
              </Link>
            </Row>
          ))}
        </Section>
      )}
    </div>
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

function WorkItemLink({ workItemId, t }: { workItemId: string; t: Translations }) {
  return (
    <span className="flex gap-3">
      <Link href={`/work-items/${workItemId}/360`} className="text-xs text-accent hover:underline">
        {t.common.viewWorkItem}
      </Link>
      <QuickViewLink workItemId={workItemId} className="text-xs text-accent hover:underline">
        {t.common.quickView}
      </QuickViewLink>
    </span>
  );
}

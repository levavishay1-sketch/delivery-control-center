"use client";

import Link from "next/link";
import { AddDependencyForm } from "@/components/AddDependencyForm";
import { RemoveDependencyButton } from "@/components/RemoveDependencyButton";
import { DependencyGraph } from "@/components/DependencyGraph";
import { useT } from "@/lib/i18n/LocaleProvider";

interface DepItem {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface UpstreamDep {
  id: string;
  reason: string;
  dependsOnWorkItem: DepItem & { pipeline: { id: string } | null };
}

interface DownstreamDep {
  id: string;
  reason: string;
  workItem: DepItem & { pipeline: { id: string } | null };
}

interface GraphData {
  nodes: { id: string; title: string; type: string; status: string }[];
  edges: { id: string; workItemId: string; dependsOnWorkItemId: string; reason: string }[];
  truncated: boolean;
}

export function DependenciesTab({
  upstream,
  downstream,
  canManage,
  workItemId,
  candidates,
  onChanged,
  graph,
}: {
  upstream: UpstreamDep[];
  downstream: DownstreamDep[];
  canManage: boolean;
  workItemId: string;
  candidates: { id: string; title: string }[];
  /** If given (e.g. by the Quick View drawer, whose data isn't a Server Component), called after a mutation instead of the default router.refresh(). */
  onChanged?: () => void;
  /** Full connected dependency neighborhood for the graph visualization. Omitted in compact contexts (the Quick View drawer) — a "Coming soon" note shows instead. */
  graph?: GraphData;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">{t.dependencies.dependsOnHeading}</h3>
        {upstream.length === 0 && <p className="mt-1 text-sm opacity-50">{t.dependencies.noUpstream}</p>}
        <div className="mt-2 flex flex-col divide-y divide-border-hairline rounded-lg border border-border-hairline">
          {upstream.map((dep) => (
            <div key={dep.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div>
                {dep.dependsOnWorkItem.pipeline ? (
                  <Link href={`/pipelines/${dep.dependsOnWorkItem.pipeline.id}`} className="text-sm underline">
                    {dep.dependsOnWorkItem.title}
                  </Link>
                ) : (
                  <span className="text-sm">{dep.dependsOnWorkItem.title}</span>
                )}
                <p className="text-xs opacity-60">
                  {dep.dependsOnWorkItem.type} · {dep.dependsOnWorkItem.status} · {dep.reason}
                </p>
              </div>
              {canManage && <RemoveDependencyButton dependencyId={dep.id} onRemoved={onChanged} />}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="mt-2">
            <AddDependencyForm workItemId={workItemId} candidates={candidates} onAdded={onChanged} />
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">{t.dependencies.dependedOnByHeading}</h3>
        {downstream.length === 0 && <p className="mt-1 text-sm opacity-50">{t.dependencies.noDownstream}</p>}
        <div className="mt-2 flex flex-col divide-y divide-border-hairline rounded-lg border border-border-hairline">
          {downstream.map((dep) => (
            <div key={dep.id} className="px-3 py-2">
              {dep.workItem.pipeline ? (
                <Link href={`/pipelines/${dep.workItem.pipeline.id}`} className="text-sm underline">
                  {dep.workItem.title}
                </Link>
              ) : (
                <span className="text-sm">{dep.workItem.title}</span>
              )}
              <p className="text-xs opacity-60">
                {dep.workItem.type} · {dep.workItem.status} · {dep.reason}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">{t.dependencies.dependencyGraphHeading}</h3>
        {graph && graph.nodes.length > 1 ? (
          <div className="mt-2">
            <DependencyGraph nodes={graph.nodes} edges={graph.edges} focusNodeId={workItemId} truncated={graph.truncated} />
          </div>
        ) : graph ? (
          <p className="mt-1 text-sm opacity-50">{t.dependencies.noConnectedGraph}</p>
        ) : (
          <p className="mt-1 text-sm opacity-50">{t.dependencies.comingSoonGraph}</p>
        )}
      </section>
    </div>
  );
}

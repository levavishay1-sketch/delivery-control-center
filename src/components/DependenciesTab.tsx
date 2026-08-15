import Link from "next/link";
import { AddDependencyForm } from "@/components/AddDependencyForm";
import { RemoveDependencyButton } from "@/components/RemoveDependencyButton";

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

export function DependenciesTab({
  upstream,
  downstream,
  canManage,
  workItemId,
  candidates,
}: {
  upstream: UpstreamDep[];
  downstream: DownstreamDep[];
  canManage: boolean;
  workItemId: string;
  candidates: { id: string; title: string }[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Depends on</h3>
        {upstream.length === 0 && <p className="mt-1 text-sm opacity-50">No upstream dependencies.</p>}
        <div className="mt-2 flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
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
              {canManage && <RemoveDependencyButton dependencyId={dep.id} />}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="mt-2">
            <AddDependencyForm workItemId={workItemId} candidates={candidates} />
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Depended on by</h3>
        {downstream.length === 0 && <p className="mt-1 text-sm opacity-50">No downstream dependents.</p>}
        <div className="mt-2 flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
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
        <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">Dependency Graph</h3>
        <p className="mt-1 text-sm opacity-50">Coming soon — visual dependency graph.</p>
      </section>
    </div>
  );
}

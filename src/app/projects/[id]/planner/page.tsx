import { notFound } from "next/navigation";
import Link from "next/link";
import { getProjectByIdForUser } from "@/domain/project/queries";
import { getProjectWorkGraph } from "@/domain/dependency/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { ForbiddenError } from "@/domain/shared/errors";
import { PlannerView } from "@/components/PlannerView";
import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export default async function ProjectPlannerPage({ params }: PageProps<"/projects/[id]/planner">) {
  const { id } = await params;

  const ctx = await requireAuthContext();
  const project = await getProjectByIdForUser(ctx, id).catch((err) => {
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!project) notFound();

  const graph = await getProjectWorkGraph(ctx, project.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Project-wide planner</p>
        <h1 className="text-xl font-semibold">
          {project.name} <span className="text-neutral-400">({project.key})</span>
        </h1>
        <Link href={`/projects/${project.id}/settings`} className="mt-1 inline-block text-xs text-accent hover:underline">
          ← Back to Settings
        </Link>
      </div>

      <Panel title="Work Graph">
        <PlannerView nodes={graph.nodes} edges={graph.edges} truncated={graph.truncated} />
      </Panel>
    </div>
  );
}

import Link from "next/link";
import { listProjectsForHome } from "@/domain/project/queries";
import { AddProjectForm } from "@/components/AddProjectForm";
import { AddWorkItemForm } from "@/components/AddWorkItemForm";
import { SyncButton } from "@/components/SyncButton";
import { StageBadge } from "@/components/StageBadge";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjectsForHome();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Projects</h1>
        <AddProjectForm />
      </section>

      <section className="flex flex-col gap-6">
        {projects.length === 0 && <p className="text-sm opacity-60">No projects yet — add one above.</p>}
        {projects.map((project) => (
          <div key={project.id} className="rounded-lg border border-black/10 dark:border-white/15 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">
                  {project.name} <span className="opacity-50">({project.key})</span>
                </h2>
                <p className="text-xs opacity-60">{project.integrationType}</p>
              </div>
              {project.integrationType !== "MANUAL" && <SyncButton projectId={project.id} />}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {project.workItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.pipeline ? `/pipelines/${item.pipeline.id}` : "#"}
                  className="flex items-center justify-between rounded border border-black/10 dark:border-white/10 px-3 py-2 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                >
                  <span>{item.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="opacity-50">{item.pipeline?.currentStage}</span>
                    {item.pipeline && <StageBadge status={item.pipeline.status} />}
                  </span>
                </Link>
              ))}
              {project.workItems.length === 0 && (
                <p className="text-sm opacity-50">No work items yet.</p>
              )}
            </div>

            <div className="mt-3">
              <AddWorkItemForm projectId={project.id} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

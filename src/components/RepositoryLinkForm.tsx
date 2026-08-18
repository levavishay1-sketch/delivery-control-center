"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface Repository {
  id: string;
  owner: string;
  name: string;
}

/** Links or unlinks a project's GitHub repository (engineering evidence source). Render only for a caller already known to have write access. */
export function RepositoryLinkForm({ projectId, repository }: { projectId: string; repository: Repository | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/repository`, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to link repository");
      return;
    }
    router.refresh();
  }

  async function unlink() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/repository`, { method: "DELETE" });
    setPending(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to unlink repository");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      {repository ? (
        <>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Linked: {repository.owner}/{repository.name}
          </span>
          <Button variant="destructive" size="sm" onClick={unlink} disabled={pending}>
            {pending ? "…" : "Unlink"}
          </Button>
        </>
      ) : (
        <Button variant="primary" size="sm" onClick={link} disabled={pending}>
          {pending ? "Linking…" : "Link repository"}
        </Button>
      )}
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}

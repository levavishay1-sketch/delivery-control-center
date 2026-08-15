"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
          <span className="text-xs opacity-70">
            Linked: {repository.owner}/{repository.name}
          </span>
          <button onClick={unlink} disabled={pending} className="rounded border border-black/15 dark:border-white/20 px-2 py-1 text-xs disabled:opacity-40">
            {pending ? "…" : "Unlink"}
          </button>
        </>
      ) : (
        <button onClick={link} disabled={pending} className="rounded bg-foreground px-2 py-1 text-xs text-background disabled:opacity-40">
          {pending ? "Linking…" : "Link repository"}
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

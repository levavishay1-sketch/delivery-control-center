export type EventRow = {
  id: string;
  workitemId: string | null;
  occurredAt: string;
  recordedAt: string;
  source: string;
  type: string;
  actor: { kind: string; userId?: string; process?: string; triggeredBy?: string };
  payload: Record<string, unknown>;
  supersedes: string | null;
  links: { rel: string; ref: string }[];
};

export type WorkItemLite = { id: string; key: string | null; title: string; phase: string };

const j = async (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

export const listWorkItems = (): Promise<WorkItemLite[]> => fetch("/api/dev/workitems").then(j);

export const getTimeline = (
  id: string,
): Promise<{ workitem: WorkItemLite & { clientId: string }; events: EventRow[] }> =>
  fetch(`/api/workitems/${id}/timeline`).then(j);

export const getBrief = (id: string): Promise<string> =>
  fetch(`/api/workitems/${id}/brief`).then((r) => r.text());

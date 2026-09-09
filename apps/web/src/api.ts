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
export type Gap = {
  id: string;
  description: string;
  blocking: boolean;
  confidence: string;
  state: "proposed" | "verified" | "dismissed" | "spun_off";
  spunOffTo: string | null;
};
export type Blocker = {
  id: string;
  workitemId: string;
  questionType: string;
  question: string;
  answer: string | null;
  state: "open" | "answered" | "abandoned";
};
export type WorkItemDetail = {
  workitem: WorkItemLite & { clientId: string; projectId: string };
  gaps: Gap[];
  blockers: Blocker[];
  events: EventRow[];
};

// Dev identity — the API auto-provisions this user on the embedded DB.
const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK_TOKEN = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const H = { "content-type": "application/json", "x-dcc-hook-token": HOOK_TOKEN, "x-dcc-dev-email": DEV_EMAIL };

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const get = <T>(p: string) => fetch(`/api${p}`, { headers: H }).then((r) => j<T>(r));
const post = <T>(p: string, body: unknown) =>
  fetch(`/api${p}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => j<T>(r));

export const listWorkItems = () => get<WorkItemLite[]>("/dev/workitems");
export const getDetail = (id: string) => get<WorkItemDetail>(`/workitems/${id}`);
export const getBrief = (id: string) => fetch(`/api/workitems/${id}/brief`, { headers: H }).then((r) => r.text());
export const getInbox = (clientId: string) => get<{ events: EventRow[] }>(`/clients/${clientId}/inbox`);
export const getBlockers = (clientId: string) => get<{ blockers: Blocker[] }>(`/clients/${clientId}/blockers`);

export const verifyGap = (gapId: string, body: { outcome: "verified" | "dismissed" | "spun_off"; clientId: string; spunOffTitle?: string; projectId?: string; ownerId?: string }) =>
  post<{ gapId: string; outcome: string; spunOffTo: string | null }>(`/gaps/${gapId}/verify`, body);
export const answerBlocker = (blockerId: string, body: { answer: string; clientId: string }) =>
  post<{ blockerId: string; state: string }>(`/blockers/${blockerId}/answer`, body);

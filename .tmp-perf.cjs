const fs = require("fs");
const edit = (f, fn) => { const o = fs.readFileSync(f, "utf8"); const n = fn(o); if (n === o) throw new Error("no change " + f); fs.writeFileSync(f, n); };
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 70)); return s.replace(a, b); };

// 1. server: the host calls run together, and the answer is kept for a short while
edit("packages/core/src/pull-request-detail.ts", (s) => {
  s = rep(s, `export async function pullRequestDetail(repoId: string, number: number, opts: { refresh?: boolean } = {}): Promise<PullRequestDetail> {
  const list = await listPullRequests({ refresh: opts.refresh });`,
`/** A request's detail costs four calls to the host; a person switching tabs should
 *  not pay for them again. Kept briefly, and skipped entirely on an explicit refresh. */
const cache = new Map<string, { at: number; value: PullRequestDetail }>();
const TTL_MS = 45_000;

export async function pullRequestDetail(repoId: string, number: number, opts: { refresh?: boolean } = {}): Promise<PullRequestDetail> {
  const key = \`\${repoId}:\${number}\`;
  if (!opts.refresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  }
  const list = await listPullRequests({ refresh: opts.refresh });`);
  s = rep(s, `  const view = slug ? await ghJson<{ body?: string; files?: GhFile[]; reviews?: GhReview[]; comments?: GhComment[] }>(["pr", "view", String(number), "--repo", url!, "--json", "body,files,reviews,comments"]) : null;
  // Both directions: what the branch gained, and what the base gained since.
  const ours = slug ? await ghJson<GhCompare>(["api", \`repos/\${slug}/compare/\${pr.baseBranch}...\${pr.headBranch}\`]) : null;
  const theirs = slug ? await ghJson<GhCompare>(["api", \`repos/\${slug}/compare/\${pr.headBranch}...\${pr.baseBranch}\`]) : null;`,
`  // Three independent questions to the host — asked together, not one after the other.
  const [view, ours, theirs] = slug
    ? await Promise.all([
        ghJson<{ body?: string; files?: GhFile[]; reviews?: GhReview[]; comments?: GhComment[] }>(["pr", "view", String(number), "--repo", url!, "--json", "body,files,reviews,comments"]),
        // Both directions: what the branch gained, and what the base gained since.
        ghJson<GhCompare>(["api", \`repos/\${slug}/compare/\${pr.baseBranch}...\${pr.headBranch}\`]),
        ghJson<GhCompare>(["api", \`repos/\${slug}/compare/\${pr.headBranch}...\${pr.baseBranch}\`]),
      ])
    : [null, null, null];`);
  s = rep(s, `  return {
    pr, blockers, nextStep, codeMap, codeMapProblem,`,
`  const value: PullRequestDetail = {
    pr, blockers, nextStep, codeMap, codeMapProblem,`);
  s = rep(s, `    groups, fileCount: files.length, timeline, branches, body: view?.body ?? "",
  };
}`, `    groups, fileCount: files.length, timeline, branches, body: view?.body ?? "",
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}`);
  return s;
});

// 2. server: the repositories are asked in parallel too
edit("packages/core/src/pull-requests.ts", (s) => rep(s,
`    for (const r of refs) {
      watched.push({ id: r.id, name: r.name, clientId: r.clientId, clientName: r.clientName, provider: "github" });
      for (const p of PROVIDERS) {
        try {
          const prs = await p.list(r);
          for (const pr of prs) raw.push({ ...pr, repo: { id: r.id, name: r.name }, client: { id: r.clientId, name: r.clientName } });
        } catch (e) {
          problems.push({ repo: r.name, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) });
        }
      }
    }`,
`    // One repository's host call must not wait for another's.
    await Promise.all(refs.map(async (r) => {
      watched.push({ id: r.id, name: r.name, clientId: r.clientId, clientName: r.clientName, provider: "github" });
      for (const p of PROVIDERS) {
        try {
          const prs = await p.list(r);
          for (const pr of prs) raw.push({ ...pr, repo: { id: r.id, name: r.name }, client: { id: r.clientId, name: r.clientName } });
        } catch (e) {
          problems.push({ repo: r.name, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) });
        }
      }
    }));`));

// 3. client: one request in flight, and a tab switch paints from what is already here
edit("apps/web/src/api.ts", (s) => rep(s,
`export const getPullRequest = (repoId: string, number: number, refresh?: boolean) =>
  get<PullRequestDetail>(\`/repos/\${repoId}/pull-requests/\${number}\${refresh ? "?refresh=1" : ""}\`);`,
`/** What the screen already has, so switching tabs paints at once instead of asking again. */
const prDetails = new Map<string, PullRequestDetail>();
const prInflight = new Map<string, Promise<PullRequestDetail>>();
export const cachedPullRequest = (repoId: string, number: number) => prDetails.get(\`\${repoId}:\${number}\`) ?? null;
export function getPullRequest(repoId: string, number: number, refresh?: boolean): Promise<PullRequestDetail> {
  const key = \`\${repoId}:\${number}\`;
  const running = prInflight.get(key);
  // Two mounts of the same screen (a tab switch, React's double effect in development) share one call.
  if (running && !refresh) return running;
  const p = get<PullRequestDetail>(\`/repos/\${repoId}/pull-requests/\${number}\${refresh ? "?refresh=1" : ""}\`)
    .then((d) => { prDetails.set(key, d); return d; })
    .finally(() => { if (prInflight.get(key) === p) prInflight.delete(key); });
  prInflight.set(key, p);
  return p;
}`));

// 4. the screen starts from what it already has
edit("apps/web/src/screens/PullRequestDetail.tsx", (s) => {
  s = rep(s, `import { getPullRequest, type PrBlocker,`, `import { cachedPullRequest, getPullRequest, type PrBlocker,`);
  s = rep(s, `  const [d, setD] = useState<Detail | null>(null);`, `  const [d, setD] = useState<Detail | null>(() => cachedPullRequest(repoId, number));`);
  s = rep(s, `  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);`, `  const load = useCallback(async (refresh?: boolean) => {
    // Something is already on screen: refresh it quietly rather than blanking it.
    setBusy(true);`);
  s = rep(s, `  if (!d) return <p className="ob-sub">טוען…</p>;`, `  if (!d) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><p className="ob-sub" style={{ marginTop: 12 }}>טוען את הבקשה מהגיט־האוסט…</p></>;`);
  return s;
});

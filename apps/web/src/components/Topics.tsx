/**
 * What a branch is about (`openspec/changes/pull-request-center`): one line per subject,
 * with how much of the branch it is. Worked out on the server from where the branch's
 * files are; the first OpenSpec changes are the branch's real subjects and are drawn stronger.
 * One component, so the request's screen and the requests list show it the same way.
 */
export type TopicItem = { title: string; detail: string };

export function TopicRows({ topics }: { topics: TopicItem[] }) {
  return (
    <>
      {topics.map((t, i) => (
        <div className={`t${i < 3 && t.detail.startsWith("OpenSpec change") ? " main" : ""}`} key={t.title}>
          <span className="n">{t.title}</span><span className="c">{t.detail.replace("OpenSpec change · ", "")}</span>
        </div>
      ))}
    </>
  );
}

import { useEffect, useState } from "react";
import { Award, ChevronDown, GitPullRequest, ShieldCheck } from "lucide-react";
import { OUTSTANDING_LABELS, OUTSTANDING_TAG_POINTS, type OutstandingBoardsResponse } from "@leadboard/contracts";
import { Link } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { useLanguage } from "../state/language";
import { AppIcon, ExternalLinkIcon } from "./AppIcon";
import { ContributorAvatar } from "./ContributorAvatar";

const categories = [
  { name: "contributor", Icon: Award },
  { name: "committer", Icon: GitPullRequest },
  { name: "maintainer", Icon: ShieldCheck },
] as const;

export function OutstandingBoards({ api }: { api: LeadBoardApiClient }) {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<OutstandingBoardsResponse | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await api.getOutstandingBoards();
        if (active) { setData(next); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : t("荣誉榜加载失败", "Could not load the honor roll"));
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, retry, t]);

  const month = data && new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${data.month}-01T00:00:00Z`));
  const expiry = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });
  const number = new Intl.NumberFormat(locale);

  return (
    <aside id="monthly-honors" className="rank-surface rank-honors" aria-labelledby="rank-honors-title">
      <div className="rank-honors-heading">
        <div><AppIcon name="trophy" size={19} /><h2 id="rank-honors-title">{t("本月荣誉榜", "Monthly Honor Roll")}</h2></div>
        {month && <time dateTime={data.month}>{month}</time>}
      </div>
      <p className="rank-honors-caption">{t(`每枚有效勋章 +${OUTSTANDING_TAG_POINTS} 分，有效期一个月`, `+${OUTSTANDING_TAG_POINTS} points per badge, valid for one month`)}</p>
      {error && <p className="rank-honors-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>{t("重试", "Retry")}</button></p>}
      {!data && !error && <p className="rank-honors-caption" role="status">{t("正在加载荣誉榜…", "Loading the honor roll…")}</p>}
      <div className="rank-honor-categories">
        {categories.map(({ name, Icon }) => {
          const board = data?.boards.find(item => item.category === name);
          const people = board?.people ?? [];
          return (
            <details className="rank-honor-category" key={name} open>
              <summary>
                <span className="rank-honor-icon"><Icon size={16} aria-hidden="true" /></span>
                <span className="rank-honor-category-title">{board?.title ?? OUTSTANDING_LABELS[name]}</span>
                {data && <span className="rank-honor-count" aria-label={t(`${people.length} 位获奖者`, `${people.length} recipients`)}>{number.format(people.length)}</span>}
                <ChevronDown className="rank-honor-chevron" size={14} aria-hidden="true" />
              </summary>
              {data && (people.length === 0
                ? <p className="rank-honor-empty">{t("本月暂无获奖者", "No recipients this month")}</p>
                : <ul className="rank-honor-people">{people.map(person => (
                  <li key={person.login}>
                    <div className="rank-honor-person">
                      <Link to={`/contributors/${encodeURIComponent(person.login)}`}>
                        <ContributorAvatar login={person.login} src={person.avatarUrl} />
                        <strong>{person.login}</strong>
                      </Link>
                      <span className="rank-score" aria-label={t(`勋章奖励 ${person.score} 分`, `${person.score} bonus points`)}>+{number.format(person.score)}</span>
                    </div>
                    {person.tags.length > 0 && <details className="rank-honor-evidence">
                      <summary>{t("获奖理由与证据", "Award details")}</summary>
                      {person.tags.map(tag => (
                        <div className="rank-honor-reason" key={tag.id}>
                          <strong>{tag.repository}</strong>
                          <p>{tag.reason}</p>
                          <p>{t("审核人", "Reviewed by")} {tag.actorLogin} · {t("有效至", "Expires")} {expiry.format(new Date(tag.expiresAt))}</p>
                          {tag.evidenceUrls.map((url, index) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer"><ExternalLinkIcon href={url} size={13} />{t("公开证据", "Public evidence")} {index + 1}</a>
                          ))}
                        </div>
                      ))}
                    </details>}
                  </li>
                ))}</ul>
              )}
            </details>
          );
        })}
      </div>
    </aside>
  );
}

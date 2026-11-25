import type { ContributorDetail } from "@leadboard/contracts";
import { CircleDot, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { AppIcon } from "./AppIcon";
import { useLanguage } from "../state/language";

export function ProfileActivity({ detail }: { detail: ContributorDetail }) {
  const { locale, t } = useLanguage();
  const number = new Intl.NumberFormat(locale);
  const activity = [
    { tone: "commit", label: "Commit", count: detail.commits, icon: <GitCommitHorizontal size={17} aria-hidden="true" /> },
    { tone: "pr", label: "PR", count: detail.prs, icon: <GitPullRequest size={17} aria-hidden="true" /> },
    { tone: "issue", label: "Issue", count: detail.issues, icon: <CircleDot size={17} aria-hidden="true" /> },
  ];
  const total = activity.reduce((sum, item) => sum + item.count, 0);
  const profile = detail.contributionProfile;
  const rate = profile?.prMergeRate ?? null;

  return (
    <>
      <dl className="profile-metrics">
        {[...activity, { tone: "points", label: t("积分", "Points"), count: detail.score ?? 0, icon: <AppIcon name="trophy" size={17} /> }].map((item) => (
          <div className="profile-surface profile-metric" data-tone={item.tone} key={item.tone}>
            <dt><span className="profile-metric-icon">{item.icon}</span>{item.label}</dt>
            <dd>{number.format(item.count)}</dd>
          </div>
        ))}
      </dl>
      <div className="profile-charts">
        <section className="profile-surface profile-chart">
          <h3>{t("活动构成", "Activity mix")}</h3>
          <p>{total > 0 ? t(`共 ${number.format(total)} 次记录`, `${number.format(total)} recorded actions`) : t("此时间范围内暂无活动", "No activity in this period")}</p>
          <div className="profile-stack" aria-hidden="true">
            {activity.filter(item => item.count > 0).map(item => (
              <span key={item.tone} data-tone={item.tone} style={{ flexGrow: item.count }} />
            ))}
          </div>
          <dl className="profile-chart-legend">
            {activity.map(item => (
              <div key={item.tone} data-tone={item.tone}>
                <dt><span aria-hidden="true" />{item.label}</dt>
                <dd>{number.format(item.count)}</dd>
              </div>
            ))}
          </dl>
        </section>
        {profile && <section className="profile-surface profile-chart profile-pr-chart">
          <div>
            <h3>{t("PR 合并率", "PR merge rate")}</h3>
            <p>{t("按所选时间内提交的 PR 统计", "Based on PRs opened in the selected period")}</p>
          </div>
          <div className="profile-pr-body">
            <div className="profile-donut" aria-hidden="true" style={{ backgroundImage: `conic-gradient(var(--profile-pr) ${rate ?? 0}%, var(--profile-track) 0)` }}>
              <span>{rate === null ? "—" : `${number.format(rate)}%`}</span>
            </div>
            <div className="profile-pr-copy">
              {rate === null ? <p>{t("暂无可统计的 PR", "No PRs in this period")}</p> : (
                <p><strong>{t(`${number.format(rate)}% 已合并`, `${number.format(rate)}% merged`)}</strong>
                  <span>{t(`提交 ${number.format(profile.submittedPrs)} 个 · 已合并 ${number.format(profile.mergedSubmittedPrs)} 个`, `${number.format(profile.mergedSubmittedPrs)} merged of ${number.format(profile.submittedPrs)} opened`)}</span>
                </p>
              )}
              <p>{t(`期间合并（含此前提交） ${number.format(profile.mergedPrs)} 个`, `${number.format(profile.mergedPrs)} merged during the period`)}</p>
            </div>
          </div>
        </section>}
      </div>
      {profile && <dl className="profile-surface profile-pulse">
        {[
          { label: t("活跃天数", "Active days"), value: profile.activeDays },
          { label: t("活跃周数", "Active weeks"), value: profile.activeWeeks },
          { label: t("参与仓库", "Repositories"), value: profile.repositories },
        ].map(({ label, value }) => (
          <div key={label}><dt>{label}</dt><dd>{number.format(value)}</dd></div>
        ))}
      </dl>}
    </>
  );
}

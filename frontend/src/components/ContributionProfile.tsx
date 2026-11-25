import { OUTSTANDING_LABELS, type ContributionTag, type ContributorDetail } from "@leadboard/contracts";
import { useLanguage } from "../state/language";
import { AppIcon, ExternalLinkIcon } from "./AppIcon";

export function ContributionBadges({ tags }: { tags: ContributionTag[] }) {
  const { t } = useLanguage();
  return <>{tags.map(tag => (
    <span className="tag" key={tag.id} title={t("平台标注 · ", "Platform award · ") + tag.repository + " · " + tag.reason}>
      {OUTSTANDING_LABELS[tag.category]} · {tag.repository}
    </span>
  ))}</>;
}

export function ContributionProfile({ detail }: { detail: ContributorDetail }) {
  const { locale, t } = useLanguage();
  const profile = detail.contributionProfile;
  const tags = detail.communityTags ?? [];
  const points = [
    [t("Issue 得分", "Issue points"), detail.commitIssueScore],
    [t("提交 PR", "PRs opened"), detail.prOpenedScore],
    [t("合并 PR", "Merged PRs"), detail.prMergedScore],
    [t("Outstanding 奖励", "Outstanding badges"), detail.outstandingScore],
    [t("仓库收录奖励", "Approved projects"), detail.projectSubmissionScore],
    [t("人工调整", "Manual adjustments"), detail.adjustmentScore],
  ] as const;
  const number = new Intl.NumberFormat(locale);

  return (
    <>
      {tags.length > 0 && <section className="profile-surface profile-badges">
        <h3><AppIcon name="trophy" size={18} />{t("Outstanding 勋章", "Outstanding badges")}</h3>
        {tags.map(tag => (
          <details key={tag.id}>
            <summary>{OUTSTANDING_LABELS[tag.category]} · {tag.repository}</summary>
            <p>{tag.reason}</p>
            <p>{tag.actorLogin} · {new Date(tag.createdAt).toLocaleDateString(locale)} · {t("有效至", "Expires")} {new Date(tag.expiresAt).toLocaleDateString(locale)}</p>
            {tag.evidenceUrls.map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noreferrer"><ExternalLinkIcon href={url} />{t("公开证据", "Public evidence")} {index + 1}</a>
            ))}
          </details>
        ))}
      </section>}
      <details className="profile-surface profile-breakdown">
        <summary>{t("积分明细与统计口径", "Points and data details")}</summary>
        <dl>{points.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number.format(value ?? 0)}</dd></div>)}</dl>
        {profile && <div className="profile-data-notes">
          <p>{t("活跃日和活跃周按北京时间统计。贡献评价数据未按计分白名单和月度上限裁剪。", "Active days and weeks use Beijing time. Contribution analytics do not apply scoring eligibility or monthly limits.")}</p>
          <p>{t(`期间提交 Issue ${number.format(profile.submittedIssues)} 个`, `${number.format(profile.submittedIssues)} issues opened in the period`)}</p>
          <p>{t("有效 Issue 认定、评审质量、代码质量、维护治理与人才培养尚未纳入统计。", "Issue validation, review quality, code quality, governance, and mentoring are not tracked yet.")}</p>
          <p>{t("最近同步", "Last synced")} · {profile.lastSyncedAt
            ? new Date(profile.lastSyncedAt).toLocaleString(locale, { timeZone: "Asia/Shanghai", timeZoneName: "short" })
            : t("暂无同步时间", "No sync timestamp")}</p>
        </div>}
      </details>
      {profile?.incomplete && <p className="profile-data-warning" role="status">{t("采集范围可能不完整，详情可到 GitHub 主页核对。", "Some activity may be missing. Check the GitHub profile for public records.")}</p>}
    </>
  );
}

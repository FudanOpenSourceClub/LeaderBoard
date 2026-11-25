import { useEffect, useState, type FormEvent } from "react";
import { OUTSTANDING_LABELS, OutstandingApplicationRequestSchema, OutstandingApplicationsResponseSchema, type OutstandingApplication, type ContributionCategory } from "@leadboard/contracts";
import { useLanguage } from "../state/language";
import { AppIcon } from "./AppIcon";
import { Button, Card, Input, Textarea } from "./ui/primitives";

export function OutstandingApplicationPanel({ csrfToken }: { csrfToken: string }) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<ContributionCategory>("contributor");
  const [repository, setRepository] = useState("");
  const [reason, setReason] = useState("");
  const [urls, setUrls] = useState("");
  const [items, setItems] = useState<OutstandingApplication[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    setHistoryError("");
    void fetch("/api/v1/outstanding-applications", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? t("无法读取申请", "Could not load applications"));
        return OutstandingApplicationsResponseSchema.parse(data);
      })
      .then(data => { if (active) setItems(data.items); })
      .catch((cause: unknown) => {
        if (active) setHistoryError(cause instanceof Error ? cause.message : t("无法读取申请", "Could not load applications"));
      });
    return () => { active = false; };
  }, [version, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSubmitted(false);

    const input = OutstandingApplicationRequestSchema.safeParse({
      category,
      repository,
      reason,
      evidenceUrls: urls.split("\n").map(url => url.trim()).filter(Boolean),
    });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? t("请核对申请资料", "Check the application details"));
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/outstanding-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(input.data),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message ?? t("申请提交失败", "Could not submit application"));
      }
      setSubmitted(true);
      setReason("");
      setUrls("");
      setVersion(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("申请提交失败", "Could not submit application"));
    } finally {
      setBusy(false);
    }
  }

  const guidelines: Record<ContributionCategory, string> = {
    contributor: t("提供被采用的贡献或被确认有效的问题反馈。", "Link to an accepted contribution or a confirmed issue report."),
    committer: t("同一仓库近 90 天至少有 3 个已合并的 PR，提交时间横跨至少两周。", "Link to at least 3 merged PRs in the same repository in the last 90 days, submitted across at least two weeks."),
    maintainer: t("提供公开维护者名单，以及近 90 天内至少两次公开维护活动的证据。", "Link to a public maintainer list and at least two public maintenance activities in the last 90 days."),
  };
  const statuses = {
    pending: t("待审核", "Pending"),
    approved: t("已通过", "Approved"),
    rejected: t("已驳回", "Rejected"),
  };

  return (
    <div className="application-layout">
      <Card className="profile-surface application-card">
        <h2>{t("申请信息", "Application details")}</h2>
        <form className="application-form" onSubmit={event => void submit(event)}>
          <label className="form-field">
            {t("申请勋章", "Badge")}
            <select className="profile-select" value={category} disabled={busy} onChange={event => setCategory(event.target.value as ContributionCategory)} aria-describedby="application-guidelines">
              {Object.entries(OUTSTANDING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p id="application-guidelines" className="application-hint">{guidelines[category]}</p>
          <label className="form-field">
            {t("申请仓库", "Repository")}
            <Input required maxLength={200} placeholder="owner/repository" value={repository} disabled={busy} onChange={event => setRepository(event.target.value)} />
          </label>
          <label className="form-field">
            {t("申请理由（审核通过后公开）", "Reason (public if approved)")}
            <Textarea required minLength={5} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
          </label>
          <label className="form-field">
            <span className="application-evidence-label"><AppIcon name="github" size={16} />{t("GitHub 贡献证据", "GitHub contribution links")}</span>
            <Textarea required value={urls} disabled={busy} placeholder="https://github.com/owner/repository/pull/123" aria-describedby="application-evidence-hint" onChange={event => setUrls(event.target.value)} />
            <small id="application-evidence-hint">{t("每行一个链接，最多 6 个，须属于同一仓库。", "Use one link per line, up to 6 links in the same repository.")}</small>
          </label>
          <Button type="submit" disabled={busy}>{busy ? t("正在提交…", "Submitting…") : t("提交申请", "Submit application")}</Button>
          {submitted && <p className="application-success" role="status">{t("申请已提交，等待审核。", "Application submitted and awaiting review.")}</p>}
          {error && <p className="application-error" role="alert">{error}</p>}
        </form>
      </Card>
      <Card className="profile-surface application-card application-history">
        <h2>{t("我的申请", "My applications")}</h2>
        {historyError ? (
          <div className="application-error" role="alert">
            {historyError} <Button variant="ghost" onClick={() => setVersion(value => value + 1)}>{t("刷新申请", "Refresh applications")}</Button>
          </div>
        ) : items === null ? (
          <p className="application-hint" role="status">{t("加载申请记录…", "Loading applications…")}</p>
        ) : items.length === 0 && <p className="application-hint">{t("暂无申请记录。", "No applications yet.")}</p>}
        {items && items.length > 0 && <ul>
          {items.map(item => (
            <li key={item.id}>
              <div><strong>{OUTSTANDING_LABELS[item.category]}</strong><span data-status={item.status}>{statuses[item.status]}</span></div>
              <p>{item.repository}</p>
              {item.reviewNote && <p>{t("审核意见", "Review notes")} · {item.reviewNote}</p>}
            </li>
          ))}
        </ul>}
      </Card>
    </div>
  );
}

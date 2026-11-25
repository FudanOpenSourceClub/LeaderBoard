import { useEffect, useState } from "react";
import { Award, ChevronDown, ShieldOff } from "lucide-react";
import {
  ApiErrorResponseSchema, ContributionTagsResponseSchema, OUTSTANDING_LABELS, OutstandingApplicationSchema,
  OutstandingApplicationsResponseSchema, type ContributionTag, type OutstandingApplication,
} from "@leadboard/contracts";
import { AdminEvidenceLink, AdminQueueHeading, AdminReviewEntry } from "../components/AdminReview";
import { Button, Input, Textarea } from "../components/ui/primitives";
import { useLanguage } from "../state/language";

async function call(path: string, options?: RequestInit) {
  const response = await fetch(`/api/v1/admin/${path}`, { cache: "no-store", ...options });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(data);
    throw new Error(parsed.success ? parsed.data.error.message : `HTTP ${response.status}`);
  }
  return data;
}

function BadgeReviewRow({ item, isOwn, busy, onReview }: {
  item: OutstandingApplication;
  isOwn: boolean;
  busy: boolean;
  onReview: (decision: "approved" | "rejected", note: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function review(decision: "approved" | "rejected") {
    setError("");
    try {
      await onReview(decision, note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("审核失败", "Review failed"));
    }
  }

  return (
    <AdminReviewEntry
      title={OUTSTANDING_LABELS[item.category]}
      titleIcon={<Award size={18} aria-hidden="true" />}
      status={item.status}
      applicant={item.login}
      createdAt={item.createdAt}
      content={item.reason}
      links={[`https://github.com/${item.repository}`, ...item.evidenceUrls]}
      busy={busy}
      reviewForm={isOwn ? null : (
        <div className="admin-review-form">
          <label className="form-field">
            {t("审核意见（驳回必填，至少 5 字）", "Review notes (at least 5 characters if rejecting)")}
            <Textarea maxLength={1000} value={note} disabled={busy} autoFocus onChange={event => setNote(event.target.value)} />
          </label>
          <div className="admin-review-buttons">
            <Button disabled={busy} onClick={() => void review("approved")}>{t("通过申请", "Approve application")}</Button>
            <Button className="admin-reject" variant="outline" disabled={busy || note.trim().length < 5} onClick={() => void review("rejected")}>{t("驳回申请", "Reject application")}</Button>
          </div>
          {error && <p className="admin-feedback" role="alert">{error}</p>}
        </div>
      )}
    >
      {isOwn && item.status === "pending" && <p className="admin-entry-note">{t("请由其他管理员审核本人的申请。", "Ask another administrator to review your application.")}</p>}
      {item.reviewNote && <p className="admin-entry-note">{t("审核意见", "Review notes")} · {item.reviewNote}</p>}
    </AdminReviewEntry>
  );
}

function ActiveBadge({ tag, isOwner, busy, onRevoke }: {
  tag: ContributionTag;
  isOwner: boolean;
  busy: boolean;
  onRevoke: (reason: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function revoke() {
    setError("");
    try {
      await onRevoke(reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("撤销失败", "Could not revoke badge"));
    }
  }

  return (
    <div className="admin-active-badge">
      <div>
        <h3>{OUTSTANDING_LABELS[tag.category]}</h3>
        <p>{tag.login} · {tag.repository}</p>
        <p>{tag.reason}</p>
      </div>
      {isOwner && <details className="admin-revoke">
        <summary><ShieldOff size={15} aria-hidden="true" />{t("撤销勋章", "Revoke badge")}<ChevronDown size={14} aria-hidden="true" /></summary>
        <div className="admin-review-form">
          <label className="form-field">
            {t("撤销原因（至少 5 字）", "Reason for revocation (at least 5 characters)")}
            <Input minLength={5} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
          </label>
          <Button className="admin-reject" variant="outline" disabled={busy || reason.trim().length < 5} onClick={() => void revoke()}>{t("确认撤销", "Confirm revocation")}</Button>
          {error && <p className="admin-feedback" role="alert">{error}</p>}
        </div>
      </details>}
    </div>
  );
}

export function ContributionTagPanel({ csrfToken, isOwner, login }: { csrfToken: string; isOwner: boolean; login: string }) {
  const { t } = useLanguage();
  const [applications, setApplications] = useState<OutstandingApplication[] | null>(null);
  const [tags, setTags] = useState<ContributionTag[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true);
    setError("");
    void Promise.all([
      call("outstanding-applications", options).then(data => OutstandingApplicationsResponseSchema.parse(data).items),
      call("contribution-tags", options).then(data => ContributionTagsResponseSchema.parse(data).items),
    ]).then(([nextApplications, nextTags]) => {
      if (!controller.signal.aborted) {
        setApplications(nextApplications);
        setTags(nextTags);
      }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("无法加载申请", "Could not load applications"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [csrfToken, version, t]);

  async function review(item: OutstandingApplication, decision: "approved" | "rejected", note: string) {
    if (saving || loading || item.status !== "pending" || login.toLowerCase() === item.login.toLowerCase()) return;
    setSaving(true);
    setNotice("");
    try {
      const result = OutstandingApplicationSchema.parse(await call(`outstanding-applications/${item.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ decision, note }),
      }));
      setApplications(current => current?.map(application => application.id === result.id ? result : application) ?? null);
      setNotice(decision === "approved" ? t("申请已通过，勋章已加入当月荣誉榜。", "Application approved. The badge appears on the monthly honor roll.") : t("申请已驳回。", "Application rejected."));
      setVersion(value => value + 1);
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string, reason: string) {
    if (saving || loading || !isOwner) return;
    setSaving(true);
    setNotice("");
    try {
      await call(`contribution-tags/${id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ reason }),
      });
      setTags(current => current?.filter(tag => tag.id !== id) ?? null);
      setNotice(t("勋章已撤销。", "Badge revoked."));
      setVersion(value => value + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="admin-queue">
        <AdminQueueHeading title={t("Outstanding 勋章申请", "Outstanding badge applications")} pending={applications?.filter(item => item.status === "pending").length ?? null} busy={loading || saving} onRefresh={() => setVersion(value => value + 1)} />
        {error && <p className="admin-feedback" role="alert">{error}</p>}
        {notice && <p className="admin-feedback" role="status">{notice}</p>}
        {applications === null && loading && <p className="admin-feedback" role="status">{t("正在加载申请…", "Loading applications…")}</p>}
        {applications?.length === 0 && <p className="admin-feedback">{t("暂无申请。", "No applications yet.")}</p>}
        {applications?.map(item => (
          <BadgeReviewRow key={item.id} item={item} isOwn={login.toLowerCase() === item.login.toLowerCase()} busy={saving || loading} onReview={(decision, note) => review(item, decision, note)} />
        ))}
      </section>
      {tags && (
        <section className="admin-queue admin-active-badges">
          <header className="admin-queue-heading"><h2>{t("当前有效勋章", "Active badges")}</h2></header>
          {tags.length === 0 && <p className="admin-feedback">{t("暂无有效勋章。", "No active badges.")}</p>}
          {tags.map(tag => <ActiveBadge key={tag.id} tag={tag} isOwner={isOwner} busy={saving || loading} onRevoke={reason => revoke(tag.id, reason)} />)}
        </section>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { Award, FolderGit2, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { ApiErrorResponseSchema, ProjectProposalAdminResponseSchema, type ProjectProposalAdmin } from "@leadboard/contracts";
import { useWebsiteSession } from "../auth/session";
import { AdminQueueHeading, AdminReviewEntry } from "../components/AdminReview";
import { AppIcon } from "../components/AppIcon";
import { Button, Textarea } from "../components/ui/primitives";
import { useLanguage } from "../state/language";
import { ContributionTagPanel } from "./ContributionTagPanel";
import { WebsiteAdminPanels } from "./WebsiteAdminPanels";

function ProjectReviewRow({ item, csrfToken, onReviewed }: {
  item: ProjectProposalAdmin;
  csrfToken: string;
  onReviewed: (item: ProjectProposalAdmin) => void;
}) {
  const { locale, t } = useLanguage();
  const [description, setDescription] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function review(decision: "approve" | "reject") {
    if (busy || item.status !== "pending") return;
    if (decision === "approve" && description.trim().length < 10) {
      setError(t("通过前请填写至少 10 字的公开简介。", "Write a public description of at least 10 characters before approving."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/admin/project-proposals/${item.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ decision, reviewNotes, ...(decision === "approve" ? { description } : {}) }),
      });
      if (!response.ok) {
        const parsed = ApiErrorResponseSchema.safeParse(await response.json().catch(() => null));
        throw new Error(parsed.success ? parsed.data.error.message : t("审核失败", "Review failed"));
      }
      onReviewed({ ...item, status: decision === "approve" ? "approved" : "rejected", reviewNotes });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("审核失败", "Review failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminReviewEntry
      title={item.labName}
      titleIcon={<AppIcon name="repo" size={18} />}
      status={item.status}
      applicant={item.submitterLogin}
      createdAt={item.createdAt}
      content={item.notes}
      links={[item.projectUrl]}
      busy={busy}
      reviewForm={
        <div className="admin-review-form">
          <label className="form-field">
            <span>{t("公开简介（通过后展示在项目列表）", "Public description (shown in the project list if approved)")}</span>
            <Textarea value={description} disabled={busy} autoFocus minLength={10} maxLength={500} placeholder={t("简要描述项目用途和特点", "Describe the project’s purpose and features")} onChange={event => setDescription(event.target.value)} />
          </label>
          <label className="form-field">
            <span>{t("审核备注", "Review notes")}</span>
            <Textarea value={reviewNotes} disabled={busy} maxLength={1000} onChange={event => setReviewNotes(event.target.value)} />
          </label>
          <div className="admin-review-buttons">
            <Button disabled={busy} onClick={() => void review("approve")}>{t("通过并收录（+20 分）", "Approve and list (+20 pts)")}</Button>
            <Button className="admin-reject" variant="outline" disabled={busy} onClick={() => void review("reject")}>{t("拒绝申请", "Reject application")}</Button>
          </div>
          {error && <p className="admin-feedback" role="alert">{error}</p>}
        </div>
      }
    >
      <p className="admin-entry-note">{t("邮件通知", "Email notification")} · {item.notificationSent
        ? t("已发送", "Sent")
        : t(`尚未确认发送（${item.notificationAttempts} 次尝试）`, `Not confirmed (${item.notificationAttempts} attempts)`)}</p>
      {item.status !== "pending" && <p className="admin-entry-note">
        {t("审核备注", "Review notes")} · {item.reviewNotes || t("无", "None")}
        {item.reviewedAt && <> · {new Date(item.reviewedAt).toLocaleString(locale, { timeZone: "Asia/Shanghai" })}</>}
      </p>}
    </AdminReviewEntry>
  );
}

function ProjectReviewQueue({ csrfToken }: { csrfToken: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<ProjectProposalAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/v1/admin/project-proposals", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) {
          const parsed = ApiErrorResponseSchema.safeParse(data);
          throw new Error(parsed.success ? parsed.data.error.message : t("无法读取申请", "Could not load applications"));
        }
        return ProjectProposalAdminResponseSchema.parse(data).items;
      })
      .then(next => { if (!controller.signal.aborted) setItems(next); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("无法读取申请", "Could not load applications"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [csrfToken, version, t]);

  function updateItem(updated: ProjectProposalAdmin) {
    setItems(current => current?.map(item => item.id === updated.id ? updated : item) ?? null);
    setNotice(updated.status === "approved" ? t("申请已通过并收录。", "Application approved and listed.") : t("申请已拒绝。", "Application rejected."));
    setVersion(value => value + 1);
  }

  return (
    <section className="admin-queue">
      <AdminQueueHeading title={t("仓库申请", "Project suggestions")} pending={items?.filter(item => item.status === "pending").length ?? null} busy={loading} onRefresh={() => setVersion(value => value + 1)}>
        <Link className="admin-queue-link" to="/projects">{t("查看项目列表", "View projects")}<AppIcon name="arrow" size={15} /></Link>
      </AdminQueueHeading>
      {error && <p className="admin-feedback" role="alert">{error}</p>}
      {notice && <p className="admin-feedback" role="status">{notice}</p>}
      {items === null && loading && <p className="admin-feedback" role="status">{t("正在加载申请…", "Loading applications…")}</p>}
      {items?.length === 0 && <p className="admin-feedback">{t("暂无申请。", "No applications yet.")}</p>}
      {items?.map(item => <ProjectReviewRow key={item.id} item={item} csrfToken={csrfToken} onReviewed={updateItem} />)}
    </section>
  );
}

export function ProjectReviewPage() {
  const { t } = useLanguage();
  const { session } = useWebsiteSession();
  const [tab, setTab] = useState<"badges" | "projects" | "site">("badges");

  if (!session.authenticated || (!session.canTag && !session.isAdmin)) {
    return <div className="admin-page"><p className="admin-feedback" role="alert">{t("当前账号没有审核权限。", "This account does not have review access.")}</p></div>;
  }

  const isOwner = session.role === "owner";
  const activeTab = isOwner ? tab : "badges";
  const sections = [
    { id: "badges", label: t("勋章申请", "Badge applications"), Icon: Award },
    { id: "projects", label: t("仓库申请", "Project suggestions"), Icon: FolderGit2 },
    { id: "site", label: t("网站管理", "Site administration"), Icon: Settings },
  ] as const;

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <h1><ShieldCheck size={25} aria-hidden="true" />{t("管理后台", "Administration")}</h1>
        <span className="admin-role">{isOwner ? t("站长", "Site owner") : t("审核员", "Reviewer")}</span>
      </header>
      {isOwner && (
        <div className="admin-navigation" role="group" aria-label={t("管理功能", "Administration sections")}>
          {sections.map(({ id, label, Icon }) => (
            <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => setTab(id)}>
              <Icon size={16} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      )}
      {activeTab === "badges" && <ContributionTagPanel key={session.login} csrfToken={session.csrfToken} isOwner={isOwner} login={session.login} />}
      {activeTab === "projects" && <ProjectReviewQueue key={session.login} csrfToken={session.csrfToken} />}
      {activeTab === "site" && <WebsiteAdminPanels key={session.login} csrfToken={session.csrfToken} isOwner={isOwner} />}
    </div>
  );
}

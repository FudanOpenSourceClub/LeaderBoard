import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, FileText, Link2, RefreshCw, UserRound } from "lucide-react";
import { useLanguage } from "../state/language";
import { AppIcon, ExternalLinkIcon } from "./AppIcon";

type ReviewStatus = "pending" | "approved" | "rejected";

export function AdminQueueHeading({ title, pending, busy, onRefresh, children }: {
  title: string;
  pending: number | null;
  busy: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  const refreshLabel = t(`刷新${title}`, `Refresh ${title}`);

  return (
    <header className="admin-queue-heading">
      <div>
        <h2>{title}</h2>
        {pending !== null && <span>{t(`${pending} 项待审核`, `${pending} pending`)}</span>}
      </div>
      <div className="admin-queue-tools">
        {children}
        <button type="button" className="admin-refresh" aria-label={refreshLabel} title={refreshLabel} aria-busy={busy} disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export function AdminEvidenceLink({ href }: { href: string }) {
  const { t } = useLanguage();
  const url = new URL(href);
  const [owner, repo, kind, value] = url.pathname.split("/").filter(Boolean);
  let label = url.hostname + (url.pathname === "/" ? "" : url.pathname);
  if (url.hostname === "github.com" && owner && repo) {
    const repository = `${owner}/${repo}`;
    switch (kind) {
      case "pull": label = value ? `PR #${value}` : repository; break;
      case "issues": label = value ? `Issue #${value}` : repository; break;
      case "discussions": label = value ? t(`讨论 #${value}`, `Discussion #${value}`) : repository; break;
      case "commit": label = value ? `Commit ${value.slice(0, 7)}` : repository; break;
      case "blob": label = url.pathname.split("/").at(-1) || repository; break;
      default: label = repository;
    }
  }
  return (
    <a className="admin-evidence-link" href={href} target="_blank" rel="noreferrer" title={href}>
      <ExternalLinkIcon href={href} size={15} />
      <span>{label}</span>
      {url.hostname === "github.com" && <ArrowUpRight size={13} aria-hidden="true" />}
    </a>
  );
}

export function AdminReviewEntry({
  title, titleIcon, status, applicant, createdAt, content, links, reviewForm, busy, children,
}: {
  title: string;
  titleIcon: ReactNode;
  status: ReviewStatus;
  applicant: string | null;
  createdAt: string;
  content: string;
  links: string[];
  reviewForm?: ReactNode;
  busy: boolean;
  children?: ReactNode;
}) {
  const { locale, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const id = useId();
  const statusLabels = { pending: t("待审核", "Pending"), approved: t("已通过", "Approved"), rejected: t("已驳回", "Rejected") };
  const hasReview = status === "pending" && Boolean(reviewForm);

  return (
    <article className="admin-review-entry">
      <header className="admin-entry-heading">
        <h3>{titleIcon}<span>{title}</span></h3>
        <div className="admin-entry-actions">
          <span className="admin-review-status" data-status={status}>{statusLabels[status]}</span>
          {hasReview && (
            <button className="admin-review-trigger" type="button" aria-expanded={open} aria-controls={id} disabled={busy} onClick={() => setOpen(value => !value)}>
              {open ? t("收起", "Collapse") : t("审核", "Review")}
            </button>
          )}
        </div>
      </header>
      <dl className="admin-entry-fields">
        <div>
          <dt><UserRound size={15} aria-hidden="true" />{t("申请人", "Applicant")}</dt>
          <dd>{applicant
            ? <a className="admin-applicant" href={`https://github.com/${encodeURIComponent(applicant)}`} target="_blank" rel="noreferrer"><AppIcon name="github" size={14} />{applicant}</a>
            : t("历史申请", "Legacy application")}</dd>
          <dd className="admin-entry-date">
            <CalendarDays size={13} aria-hidden="true" />
            <time dateTime={createdAt}>{new Date(createdAt).toLocaleDateString(locale, { timeZone: "Asia/Shanghai" })}</time>
          </dd>
        </div>
        <div>
          <dt><FileText size={15} aria-hidden="true" />{t("申请内容", "Submission")}</dt>
          <dd className="admin-entry-content">{content}</dd>
        </div>
      </dl>
      <div className="admin-entry-links">
        <span><Link2 size={15} aria-hidden="true" />{t("相关链接", "Related links")}</span>
        {Array.from(new Set(links)).map(href => <AdminEvidenceLink key={href} href={href} />)}
      </div>
      {children}
      {hasReview && <div id={id} hidden={!open} className="admin-review-disclosure">{open && reviewForm}</div>}
    </article>
  );
}

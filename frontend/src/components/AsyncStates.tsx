import { useLanguage } from "../state/language";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLanguage();
  return <div className="async-state" role="status"><span className="spinner" aria-hidden="true" />{label ?? t("正在加载数据…", "Loading…")}</div>;
}

export function EmptyState({ label }: { label?: string }) {
  const { t } = useLanguage();
  return <div className="async-state" role="status">{label ?? t("当前筛选下暂无数据", "No data matches these filters")}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="async-state error-state" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry}>{t("重试", "Retry")}</button>}
    </div>
  );
}

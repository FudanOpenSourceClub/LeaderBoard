import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { OutstandingApplicationPanel } from "../components/OutstandingApplicationPanel";
import { useLanguage } from "../state/language";

export function OutstandingApplicationPage({ profileUrl, csrfToken }: { profileUrl: string; csrfToken: string }) {
  const { t } = useLanguage();

  return (
    <div className="application-page">
      <Link className="profile-back" to={profileUrl}><ArrowLeft size={16} aria-hidden="true" />{t("返回个人档案", "Back to profile")}</Link>
      <header className="application-heading">
        <h1>{t("申请 Outstanding 勋章", "Apply for an Outstanding badge")}</h1>
        <p>{t("审核通过后进入当月荣誉榜。每枚勋章加 15 分，自审核通过起有效一个月。", "An approved badge appears on the monthly honor roll and earns 15 points for one month.")}</p>
      </header>
      <OutstandingApplicationPanel csrfToken={csrfToken} />
    </div>
  );
}

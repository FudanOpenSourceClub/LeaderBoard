import { getDbPool, withTransaction } from "../db/index.js";
import { smtpSender } from "../auth/index.js";
import type { MailSender } from "../auth/smtp.js";

export class ProjectNotificationWorker {
  constructor(private readonly sender: MailSender = smtpSender(process.env),
    private readonly recipient = process.env.PROJECT_REVIEW_EMAIL?.trim() || "swiftgorge5@gmail.com",
    private readonly siteUrl = process.env.SITE_URL?.trim() || "https://47.116.20.196") {}
  async runOnce(): Promise<void> {
    for(let i=0;i<20;i++){
      const row=await withTransaction(async client=>{
        const claimed=await client.query<{id:string;proposal_id:string}>(`SELECT id::text,proposal_id::text FROM project_notification_outbox
          WHERE sent_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const item=claimed.rows[0];if(!item)return null;
        await client.query("UPDATE project_notification_outbox SET lease_until=now()+interval '3 minutes',attempt_count=attempt_count+1 WHERE id=$1",[item.id]);
        return item;
      });
      if(!row)return;
      try{
        const result=await getDbPool().query<{project_url:string;lab_name:string;notes:string;login:string|null}>(`SELECT p.project_url,p.lab_name,p.notes,g.login
          FROM project_proposals p LEFT JOIN member_github_accounts a ON a.member_id=p.member_id AND a.is_primary=TRUE
          LEFT JOIN github_accounts g ON g.github_id=a.github_id WHERE p.id=$1`,[row.proposal_id]);
        const proposal=result.rows[0];if(!proposal)throw new Error("Proposal missing");
        const link=new URL("/admin",this.siteUrl);link.searchParams.set("proposal",row.proposal_id);
        await this.sender.sendMail({to:this.recipient,subject:`LeaderBoard 仓库加入申请 #${row.proposal_id}`,
          text:`收到新的仓库加入申请。\n\n申请编号：${row.proposal_id}\n申请人 GitHub：${proposal.login??"历史申请"}\n仓库：${proposal.project_url}\n实验室/团队：${proposal.lab_name}\n\n申请说明：\n${proposal.notes}\n\n请登录管理后台审核：${link}\n\n此邮件仅为通知，点击链接不会自动批准申请。`});
        await getDbPool().query("UPDATE project_notification_outbox SET sent_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1",[row.id]);
      }catch{
        await getDbPool().query(`UPDATE project_notification_outbox SET lease_until=NULL,last_error='NotificationDeliveryError',
          next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempt_count,6)))::int) WHERE id=$1`,[row.id]);
      }
    }
  }
}
export function startProjectNotifications(worker: ProjectNotificationWorker): {stop():Promise<void>} {
  let active:Promise<void>|null=null;
  const tick=()=>{if(!active)active=worker.runOnce().catch(()=>console.error("Project notification worker failed")).finally(()=>{active=null})};
  tick();const timer=setInterval(tick,30000);timer.unref();
  return {async stop(){clearInterval(timer);await active;}};
}

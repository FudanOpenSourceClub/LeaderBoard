import type { OutstandingApplication, OutstandingApplicationRequest, OutstandingApplicationReview } from '@leadboard/contracts';
import { getDbPool, withTransaction } from '../db/index.js';
import { AdminError, auditAdmin } from '../auth/roles.js';
import { grantContributionTag } from './contribution-tags.js';

interface Row {
  id:string; contributor_id:string; github_id:string; login:string; category:OutstandingApplication['category'];
  repository:string; evidence_urls:string[]; reason:string; status:OutstandingApplication['status'];
  created_at:Date; reviewed_at:Date|null; reviewer_login:string|null; review_note:string; tag_id:string|null;
}
const select=`SELECT a.id::text,a.contributor_id::text,c.github_id::text,c.login,a.category,a.repository,a.evidence_urls,a.reason,
  a.status,a.created_at,a.reviewed_at,a.reviewer_login,a.review_note,a.tag_id::text
  FROM outstanding_applications a JOIN contributors c ON c.id=a.contributor_id`;
const output=(r:Row):OutstandingApplication=>({id:r.id,githubId:r.github_id,login:r.login,category:r.category,
  repository:r.repository,evidenceUrls:r.evidence_urls,reason:r.reason,status:r.status,createdAt:r.created_at.toISOString(),
  reviewedAt:r.reviewed_at?.toISOString()??null,reviewerLogin:r.reviewer_login,reviewNote:r.review_note,tagId:r.tag_id});

export class OutstandingApplicationService {
  async list(githubId?:string) {
    const result=await getDbPool().query<Row>(select+(githubId?' WHERE c.github_id=$1':'')+
      " ORDER BY (a.status='pending') DESC,a.created_at DESC,a.id DESC LIMIT 200",githubId?[githubId]:[]);
    return result.rows.map(output);
  }
  async apply(githubId:string,input:OutstandingApplicationRequest) {
    return withTransaction(async client=>{
      // The same lock is used by tag awards and role changes, preventing duplicate awards and approval races.
      await client.query('SELECT pg_advisory_xact_lock(7983161)');
      const contributor=(await client.query<{id:string}>(`SELECT id::text FROM contributors WHERE github_id=$1
        AND enrolled_at IS NOT NULL AND is_bot=FALSE AND login IS NOT NULL`,[githubId])).rows[0];
      if(!contributor)throw new AdminError('CONTRIBUTOR_REQUIRED',403,'请先加入开源达人榜再申请勋章');
      const duplicate=await client.query(`SELECT id FROM outstanding_applications WHERE contributor_id=$1
        AND category=$2 AND lower(repository)=lower($3) AND status='pending'`,[contributor.id,input.category,input.repository]);
      if(duplicate.rows.length)throw new AdminError('APPLICATION_PENDING',409,'该仓库的同类勋章申请正在审核中');
      const active=await client.query(`SELECT id FROM contribution_tags WHERE contributor_id=$1 AND category=$2
        AND lower(repository)=lower($3) AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[contributor.id,input.category,input.repository]);
      if(active.rows.length)throw new AdminError('TAG_EXISTS',409,'此仓库已有该类有效勋章，请到期后再申请');
      const row=(await client.query<{id:string}>(`INSERT INTO outstanding_applications(contributor_id,category,repository,evidence_urls,reason)
        VALUES($1,$2,$3,$4,$5) RETURNING id::text`,[contributor.id,input.category,input.repository,JSON.stringify(input.evidenceUrls),input.reason])).rows[0]!;
      return output((await client.query<Row>(select+' WHERE a.id=$1',[row.id])).rows[0]!);
    });
  }
  async review(actorId:string,id:string,input:OutstandingApplicationReview) {
    return withTransaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(7983161)');
      const actor=(await client.query<{role:string;login:string}>(`SELECT role,login FROM website_roles
        WHERE github_id=$1 AND revoked_at IS NULL`,[actorId])).rows[0];
      if(!actor||!['owner','admin'].includes(actor.role))throw new AdminError('TAGGER_REQUIRED',403,'当前账号没有勋章审核权限');
      const application=(await client.query<Row>(select+' WHERE a.id=$1 FOR UPDATE OF a',[id])).rows[0];
      if(!application)throw new AdminError('APPLICATION_NOT_FOUND',404,'勋章申请不存在');
      if(actorId===application.github_id)throw new AdminError('SELF_REVIEW_DENIED',403,'不能审核自己的勋章申请，请由其他管理员审核');
      if(application.status!=='pending')throw new AdminError('APPLICATION_REVIEWED',409,'该申请已审核，请刷新列表');
      const tag=input.decision==='approved'?await grantContributionTag(client,actorId,{
        githubId:application.github_id,category:application.category,evidenceUrls:application.evidence_urls,
        reason:application.reason,confirmed:true,
      }):null;
      await client.query(`UPDATE outstanding_applications SET status=$2,reviewed_at=clock_timestamp(),reviewer_github_id=$3,
        reviewer_login=$4,review_note=$5,tag_id=$6 WHERE id=$1`,[id,input.decision,actorId,actor.login,input.note,tag?.id??null]);
      await auditAdmin(client,{githubId:actorId,login:actor.login},{githubId:application.github_id,login:application.login},
        'outstanding.review',input.note||'审核通过本人提交的 Outstanding 申请',{id,decision:input.decision,tagId:tag?.id??null});
      return output((await client.query<Row>(select+' WHERE a.id=$1',[id])).rows[0]!);
    });
  }
}

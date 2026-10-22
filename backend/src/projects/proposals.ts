import { type CampusProject, type ProjectProposalAdmin, type ProjectProposalRequest, type ProjectReviewRequest } from "@leadboard/contracts";
import { getDbPool, withTransaction } from "../db/index.js";

export class ProjectError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {super(message);}
}
export interface ProjectProposalApi { submit(input: ProjectProposalRequest, memberId: string): Promise<{submitted:true;id:number}> }
export interface RepositoryIdentity { githubId:string;fullName:string;name:string;url:string }
export async function lookupProject(url: string): Promise<RepositoryIdentity> {
  const match=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(url);
  if(!match)throw new ProjectError("INVALID_REPOSITORY",400,"请填写 GitHub 仓库地址");
  const repo=match[2]!.replace(/\.git$/i,"");
  const response=await fetch(`https://api.github.com/repos/${encodeURIComponent(match[1]!)}/${encodeURIComponent(repo)}`,{
    headers:{Accept:"application/vnd.github+json","User-Agent":"LeaderBoard",...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(15000),
  });
  if(response.status===404)throw new ProjectError("REPOSITORY_NOT_FOUND",400,"无法找到公开的 GitHub 仓库");
  if(!response.ok)throw new ProjectError("REPOSITORY_LOOKUP_FAILED",503,"暂时无法核验 GitHub 仓库，请稍后再试");
  const data=await response.json() as {id?:unknown;full_name?:unknown;name?:unknown;html_url?:unknown;private?:unknown};
  if(typeof data.id!=="number"||!Number.isSafeInteger(data.id)||data.id<=0||data.private!==false
    ||typeof data.full_name!=="string"||!/^[-\w.]+\/[-\w.]+$/.test(data.full_name)||typeof data.name!=="string")
    throw new ProjectError("INVALID_REPOSITORY",400,"只能申请加入公开的 GitHub 仓库");
  return {githubId:String(data.id),fullName:data.full_name,name:data.name,url:`https://github.com/${data.full_name}`};
}
export class ProjectProposalService implements ProjectProposalApi {
  constructor(private readonly lookup: typeof lookupProject = lookupProject) {}
  async submit(input: ProjectProposalRequest, memberId: string): Promise<{submitted:true;id:number}> {
    const repo=await this.lookup(input.projectUrl);
    return withTransaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["project:"+repo.githubId]);
      const member=await client.query(`SELECT 1 FROM members m JOIN member_github_accounts a ON a.member_id=m.id
        WHERE m.id=$1 AND m.verification_status='verified' AND m.student_fingerprint IS NOT NULL`,[memberId]);
      if(!member.rows.length)throw new ProjectError("REGISTRATION_REQUIRED",401,"请先注册 LeaderBoard 再提交申请");
      const existing=await client.query(`SELECT 1 FROM campus_projects WHERE repository_github_id=$1
        UNION ALL SELECT 1 FROM project_proposals WHERE repository_github_id=$1 AND status='pending' LIMIT 1`,[repo.githubId]);
      if(existing.rows.length)throw new ProjectError("PROJECT_ALREADY_SUBMITTED",409,"该仓库已经收录或已有待审核申请");
      const result=await client.query<{id:number}>(`INSERT INTO project_proposals(project_url,lab_name,notes,member_id,repository_github_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id::int`,[repo.url,input.labName,input.notes,memberId,repo.githubId]);
      const id=result.rows[0]!.id;
      await client.query("INSERT INTO project_notification_outbox(proposal_id) VALUES ($1)",[id]);
      return {submitted:true,id};
    });
  }
  async list(): Promise<ProjectProposalAdmin[]> {
    const result=await getDbPool().query(`SELECT p.id::int,p.project_url AS "projectUrl",p.lab_name AS "labName",p.notes,p.status,
      g.login AS "submitterLogin",p.created_at AS "createdAt",p.reviewed_at AS "reviewedAt",p.review_notes AS "reviewNotes",
      (o.sent_at IS NOT NULL) AS "notificationSent",coalesce(o.attempt_count,0) AS "notificationAttempts"
      FROM project_proposals p LEFT JOIN member_github_accounts a ON a.member_id=p.member_id AND a.is_primary=TRUE
      LEFT JOIN github_accounts g ON g.github_id=a.github_id LEFT JOIN project_notification_outbox o ON o.proposal_id=p.id
      ORDER BY (p.status='pending') DESC,p.created_at DESC LIMIT 200`);
    return result.rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),reviewedAt:row.reviewedAt?.toISOString()??null})) as ProjectProposalAdmin[];
  }
  async review(id: number, input: ProjectReviewRequest, reviewerGithubId: string): Promise<void> {
    const found=await getDbPool().query<{project_url:string;repository_github_id:string|null}>("SELECT project_url,repository_github_id::text FROM project_proposals WHERE id=$1",[id]);
    if(!found.rows[0])throw new ProjectError("PROPOSAL_NOT_FOUND",404,"申请不存在");
    const repo=input.decision==="approve"?await this.lookup(found.rows[0].project_url):null;
    if(repo&&found.rows[0].repository_github_id&&repo.githubId!==found.rows[0].repository_github_id)
      throw new ProjectError("REPOSITORY_CHANGED",409,"仓库地址对应的 GitHub ID 已变化，请核对后重新提交申请");
    await withTransaction(async client=>{
      const result=await client.query<{status:string;lab_name:string}>("SELECT status,lab_name FROM project_proposals WHERE id=$1 FOR UPDATE",[id]);
      const row=result.rows[0];
      if(!row||row.status!=="pending")throw new ProjectError("PROPOSAL_ALREADY_REVIEWED",409,"该申请已处理，请刷新页面");
      if(repo){
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["project:"+repo.githubId]);
        const existing=await client.query("SELECT 1 FROM campus_projects WHERE repository_github_id=$1",[repo.githubId]);
        if(existing.rows.length)throw new ProjectError("PROJECT_ALREADY_INCLUDED",409,"该仓库已经收录");
        await client.query(`INSERT INTO campus_projects(repository_github_id,full_name,name,html_url,lab_name,lab_url,description,tags,proposal_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[repo.githubId,repo.fullName,repo.name,repo.url,row.lab_name,input.labUrl??null,input.description,input.tags??["社区收录"],id]);
      }
      await client.query(`UPDATE project_proposals SET status=$2,reviewed_by=$3,reviewed_at=now(),review_notes=$4,updated_at=now() WHERE id=$1`,[id,input.decision==="approve"?"approved":"rejected",reviewerGithubId,input.reviewNotes]);
    });
  }
  async projects(): Promise<CampusProject[]> {
    const result=await getDbPool().query(`SELECT name,full_name AS repo,html_url AS url,lab_name AS lab,lab_url AS "labUrl",description,tags FROM campus_projects ORDER BY id`);
    return result.rows as CampusProject[];
  }
}

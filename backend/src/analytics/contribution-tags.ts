import type {Pool,PoolClient} from "pg";
import {OUTSTANDING_LABELS,OUTSTANDING_TAG_POINTS,type OutstandingBoardsResponse,type ContributionTag,type AddContributionTagRequest} from "@leadboard/contracts";
import {getDbPool,withTransaction} from "../db/index.js";
import {AdminError,auditAdmin,lockAdmin} from "../auth/roles.js";
import {getContributionScores} from "./scoring.js";
interface Row{id:string;contributor_id:string;github_id:string;login:string;category:ContributionTag['category'];repository:string;evidence_urls:string[];reason:string;actor_login:string;created_at:Date;expires_at:Date;avatar_url:string|null;revoked_at:Date|null}
const sql=`SELECT t.id::text,t.contributor_id::text,c.github_id::text,c.login,t.category,t.repository,t.evidence_urls,t.reason,t.actor_login,t.created_at,t.expires_at,c.avatar_url,t.revoked_at FROM contribution_tags t JOIN contributors c ON c.id=t.contributor_id`;
const output=(r:Row):ContributionTag=>({id:r.id,githubId:r.github_id,login:r.login,category:r.category,repository:r.repository,evidenceUrls:r.evidence_urls,reason:r.reason,actorLogin:r.actor_login,createdAt:r.created_at.toISOString(),expiresAt:r.expires_at.toISOString(),revokedAt:r.revoked_at?.toISOString()??null});
export async function getTagMap(pool:Pick<Pool,'query'>,ids:string[],now=new Date()){
  const map=new Map<string,ContributionTag[]>();if(!ids.length)return map;
  const rows=(await pool.query<Row>(sql+' WHERE t.revoked_at IS NULL AND t.created_at<=$2 AND t.expires_at>$2 AND t.contributor_id=ANY($1::bigint[]) ORDER BY t.id DESC',[ids,now])).rows;
  for(const r of rows)map.set(r.contributor_id,[...(map.get(r.contributor_id)??[]),output(r)]);return map;
}
export async function getOutstandingBoards(pool:Pick<Pool,'query'>=getDbPool(),now=new Date()):Promise<OutstandingBoardsResponse>{
  const rows=(await pool.query<Row>(sql+` WHERE t.revoked_at IS NULL AND c.is_bot=FALSE
    AND c.login IS NOT NULL AND t.created_at<=$1 AND t.expires_at>$1 ORDER BY t.created_at DESC,t.id DESC`,[now])).rows;
  const categories=['contributor','committer','maintainer'] as const;
  return {asOf:now.toISOString(),month:new Date(now.getTime()+8*3600000).toISOString().slice(0,7),
    boards:categories.map(category=>{
      const people=new Map<string,{login:string;avatarUrl:string|null;score:number;tags:ContributionTag[]}>();
      for(const r of rows.filter(r=>r.category===category)){
        const person=people.get(r.github_id)??{login:r.login,avatarUrl:r.avatar_url,score:0,tags:[]};
        person.tags.push(output(r));person.score+=OUTSTANDING_TAG_POINTS;people.set(r.github_id,person);
      }
      return {category,title:OUTSTANDING_LABELS[category],people:[...people.values()]
        .sort((a,b)=>b.score-a.score||a.login.localeCompare(b.login)).map((person,i)=>({...person,rank:i+1}))};
    })};
}
export class ContributionTagService{
  async list(){return (await getDbPool().query<Row>(sql+' WHERE t.revoked_at IS NULL AND t.expires_at>clock_timestamp() ORDER BY t.id DESC LIMIT 200')).rows.map(output)}
  async search(query:string){return (await getDbPool().query<{github_id:string;login:string}>(`SELECT github_id::text,login FROM contributors WHERE is_bot=FALSE AND github_id IS NOT NULL AND login IS NOT NULL AND strpos(lower(login),lower($1))>0 ORDER BY lower(login) LIMIT 20`,[query])).rows.map(r=>({githubId:r.github_id,login:r.login}))}
  async add(actorId:string,input:AddContributionTagRequest){return withTransaction(client=>grantContributionTag(client,actorId,input))}
  async revoke(actorId:string,id:string,reason:string){return withTransaction(async client=>{
    const actor=await lockAdmin(client,actorId);const tag=(await client.query<Row>(sql+' WHERE t.id=$1',[id])).rows[0];
    if(!tag)throw new AdminError('TAG_NOT_FOUND',404,'标签不存在');
    if(!tag.revoked_at){await client.query('UPDATE contribution_tags SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1',[id,actorId]);await auditAdmin(client,{githubId:actorId,login:actor.login},{githubId:tag.github_id,login:tag.login},'tag.revoke',reason,{id})}
    return output((await client.query<Row>(sql+' WHERE t.id=$1',[id])).rows[0]!);
  })}
}

/** Called within the application review transaction so awarding and review commit together. */
export async function grantContributionTag(client:PoolClient,actorId:string,input:AddContributionTagRequest){
    await client.query('SELECT pg_advisory_xact_lock(7983161)');
    const actor=(await client.query<{role:string;login:string}>('SELECT role,login FROM website_roles WHERE github_id=$1 AND revoked_at IS NULL',[actorId])).rows[0];
    if(!actor||!['admin','owner'].includes(actor.role))throw new AdminError('TAGGER_REQUIRED',403,'当前账号没有标签添加权限');
    if(actorId===input.githubId)throw new AdminError('SELF_TAG_DENIED',403,'不能给自己添加标签，请由其他标注员核对');
    const target=(await client.query<{id:string;login:string}>('SELECT id::text,login FROM contributors WHERE github_id=$1 AND is_bot=FALSE AND login IS NOT NULL',[input.githubId])).rows[0];
    if(!target)throw new AdminError('CONTRIBUTOR_NOT_FOUND',404,'请选择已有的贡献者');
    const repository=new URL(input.evidenceUrls[0]!).pathname.split('/').slice(1,3).join('/');
    if(input.category==='committer'){
      const to=new Date(),from=new Date(to.getTime()-90*86400000);
      const data=await getContributionScores(client,from.toISOString(),to.toISOString());
      const numbers=new Set(input.evidenceUrls.map(u=>new URL(u).pathname.match(/\/pull\/(\d+)$/)?.[1]).filter(Boolean));
      const prs=data.decisions.filter(d=>d.contributorId===target.id&&d.kind==='pull_request'&&d.repository.toLowerCase()===repository.toLowerCase()&&numbers.has(d.identifier)&&Date.parse(d.occurredAt)>=from.getTime()&&d.mergedAt!==null&&Date.parse(d.mergedAt)<to.getTime());
      const weeks=new Set(prs.map(d=>Math.floor((Date.parse(d.occurredAt)+8*3600000+3*86400000)/(7*86400000))));
      if(prs.length<3||weeks.size<2)throw new AdminError('COMMITTER_EVIDENCE_REQUIRED',400,'已采集数据中需有该项目近90天至少3个合并 PR，提交跨至少两周；数据未同步时请先由站长检查同步');
    }
    const existing=(await client.query<Row>(sql+' WHERE t.contributor_id=$1 AND t.category=$2 AND lower(t.repository)=lower($3) AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp()',[target.id,input.category,repository])).rows[0];
    if(existing)throw new AdminError('TAG_EXISTS',409,'此项目已有该类有效奖励标签，请到期后再评选');
    const row=(await client.query<{id:string}>(`INSERT INTO contribution_tags(contributor_id,category,repository,evidence_urls,reason,actor_github_id,actor_login) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,[target.id,input.category,repository,JSON.stringify(input.evidenceUrls),input.reason,actorId,actor.login])).rows[0]!;
    await auditAdmin(client,{githubId:actorId,login:actor.login},{githubId:input.githubId,login:target.login},'tag.add',input.reason,{id:row.id,category:input.category,repository,evidenceUrls:input.evidenceUrls,confirmed:true});
    return output((await client.query<Row>(sql+' WHERE t.id=$1',[row.id])).rows[0]!);
}

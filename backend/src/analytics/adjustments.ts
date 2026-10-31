import type { Pool, PoolClient } from "pg";
import type { ScoreAdjustment, ScoreAdjustmentRequest } from "@leadboard/contracts";
import { getDbPool, withTransaction } from "../db/index.js";
import { AdminError, auditAdmin, lockAdmin } from "../auth/roles.js";

const ledgerSql=`SELECT a.id::text,c.github_id::text,c.login,a.delta,a.reason,a.actor_login,a.created_at,
  a.request_id::text,a.reverses_id::text,EXISTS(SELECT 1 FROM contributor_score_adjustments undo WHERE undo.reverses_id=a.id) AS reversed
  FROM contributor_score_adjustments a JOIN contributors c ON c.id=a.contributor_id`;
interface LedgerRow {id:string;github_id:string;login:string;delta:number;reason:string;actor_login:string;created_at:Date;request_id:string;reverses_id:string|null;reversed:boolean}
function entry(r:LedgerRow):ScoreAdjustment {
  return {id:r.id,githubId:r.github_id,login:r.login,delta:r.delta,reason:r.reason,actorLogin:r.actor_login,
    createdAt:r.created_at.toISOString(),requestId:r.request_id,reversesId:r.reverses_id,reversed:r.reversed};
}
async function getEntry(client:PoolClient,requestId:string) {
  const result=await client.query<LedgerRow>(ledgerSql+" WHERE a.request_id=$1",[requestId]);
  return result.rows[0]?entry(result.rows[0]):null;
}
export async function getScoreAdjustments(pool:Pool,from:string|null,to:string):Promise<Map<string,number>> {
  const result=await pool.query<{contributor_id:string;points:string}>(`SELECT a.contributor_id::text,sum(a.delta)::text AS points
    FROM contributor_score_adjustments a JOIN contributors c ON c.id=a.contributor_id
    WHERE c.is_bot=FALSE AND ($1::timestamptz IS NULL OR a.created_at >= $1) AND a.created_at < $2
    GROUP BY a.contributor_id`,[from,to]);
  return new Map(result.rows.map(r=>{const n=Number(r.points);if(!Number.isSafeInteger(n))throw new Error("Invalid adjustment total");return [r.contributor_id,n]}));
}
export class ScoreAdjustmentService {
  async contributors(query:string) {
    const result=await getDbPool().query<{github_id:string;login:string}>(`SELECT github_id::text,login FROM contributors
      WHERE is_bot=FALSE AND github_id IS NOT NULL AND login IS NOT NULL AND strpos(lower(login),lower($1))>0
      ORDER BY lower(login) LIMIT 20`,[query]);
    return result.rows.map(r=>({githubId:r.github_id,login:r.login}));
  }
  async list(githubId?:string) {
    const result=await getDbPool().query<LedgerRow>(ledgerSql+" WHERE ($1::bigint IS NULL OR c.github_id=$1) ORDER BY a.id DESC LIMIT 200",[githubId??null]);
    return result.rows.map(entry);
  }
  async adjust(actorId:string,input:ScoreAdjustmentRequest) {
    return withTransaction(async client=>{
      const actor=await lockAdmin(client,actorId);
      const existing=await getEntry(client,input.requestId);
      if(existing) {
        const actorResult=await client.query<{actor_github_id:string}>("SELECT actor_github_id::text FROM contributor_score_adjustments WHERE request_id=$1",[input.requestId]);
        if(existing.githubId!==input.githubId || existing.delta!==input.delta || existing.reason!==input.reason || existing.reversesId!==null || actorResult.rows[0]!.actor_github_id!==actorId)
          throw new AdminError("IDEMPOTENCY_CONFLICT",409,"重复请求与原记录不一致，请刷新后重试");
        return existing;
      }
      const target=(await client.query<{id:string;login:string}>("SELECT id::text,login FROM contributors WHERE github_id=$1 AND is_bot=FALSE AND login IS NOT NULL",[input.githubId])).rows[0];
      if(!target)throw new AdminError("CONTRIBUTOR_NOT_FOUND",404,"请先选择已有的贡献者");
      await client.query(`INSERT INTO contributor_score_adjustments(contributor_id,delta,reason,actor_github_id,actor_login,request_id)
        VALUES ($1,$2,$3,$4,$5,$6)`,[target.id,input.delta,input.reason,actorId,actor.login,input.requestId]);
      await auditAdmin(client,{githubId:actorId,login:actor.login},{githubId:input.githubId,login:target.login},"score.adjust",input.reason,{delta:input.delta,requestId:input.requestId});
      return (await getEntry(client,input.requestId))!;
    });
  }
  async reverse(actorId:string,id:string,reason:string,requestId:string) {
    return withTransaction(async client=>{
      const actor=await lockAdmin(client,actorId);
      const existing=await getEntry(client,requestId);
      if(existing) {
        const owner=(await client.query<{actor_github_id:string}>("SELECT actor_github_id::text FROM contributor_score_adjustments WHERE request_id=$1",[requestId])).rows[0]!;
        if(existing.reversesId!==id || existing.reason!==reason || owner.actor_github_id!==actorId)throw new AdminError("IDEMPOTENCY_CONFLICT",409,"重复请求与原记录不一致");
        return existing;
      }
      const original=(await client.query<LedgerRow>(ledgerSql+" WHERE a.id=$1",[id])).rows[0];
      if(!original)throw new AdminError("ADJUSTMENT_NOT_FOUND",404,"调分记录不存在");
      if(original.reversed || original.reverses_id)throw new AdminError("ALREADY_REVERSED",409,"该记录已撤销或本身为撤销记录");
      await client.query(`INSERT INTO contributor_score_adjustments(contributor_id,delta,reason,actor_github_id,actor_login,request_id,reverses_id)
        SELECT contributor_id,-delta,$2,$3,$4,$5,id FROM contributor_score_adjustments WHERE id=$1`,[id,reason,actorId,actor.login,requestId]);
      await auditAdmin(client,{githubId:actorId,login:actor.login},{githubId:original.github_id,login:original.login},"score.reverse",reason,{reversesId:id,delta:-original.delta,requestId});
      return (await getEntry(client,requestId))!;
    });
  }
}

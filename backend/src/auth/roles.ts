import type { PoolClient } from "pg";
import type { WebsiteRole } from "@leadboard/contracts";
import { getDbPool, withTransaction } from "../db/index.js";

export class AdminError extends Error {
  constructor(readonly code:string, readonly status:number, message:string) { super(message); }
}
export async function getWebsiteRole(githubId:string):Promise<WebsiteRole|null> {
  const result=await getDbPool().query<{role:WebsiteRole}>(
    "SELECT role FROM website_roles WHERE github_id=$1 AND revoked_at IS NULL",[githubId]);
  return result.rows[0]?.role??null;
}
// Serialize permission changes and privileged writes, including revocation races.
export async function lockAdmin(client:PoolClient,actorId:string,ownerOnly=true) {
  await client.query("SELECT pg_advisory_xact_lock(7983161)");
  const result=await client.query<{role:WebsiteRole;login:string}>(
    "SELECT role,login FROM website_roles WHERE github_id=$1 AND revoked_at IS NULL",[actorId]);
  const actor=result.rows[0];
  if(!actor || actor.role!=="owner") throw new AdminError("ADMIN_REQUIRED",403,"仅站长可以审核项目、调分和管理授权");
  return actor;
}
export async function auditAdmin(client:PoolClient,actor:{githubId:string;login:string},target:{githubId:string;login:string},action:string,reason:string,details:unknown={}) {
  await client.query(`INSERT INTO website_admin_audit(actor_github_id,actor_login,target_github_id,target_login,action,reason,details)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,[actor.githubId,actor.login,target.githubId,target.login,action,reason,JSON.stringify(details)]);
}
export async function setWebsiteRole(actorId:string,target:{githubId:string;login:string},role:WebsiteRole|null,reason:string) {
  return withTransaction(async client=>{
    const actor=await lockAdmin(client,actorId,true);
    const previous=(await client.query<{role:WebsiteRole}>("SELECT role FROM website_roles WHERE github_id=$1 AND revoked_at IS NULL",[target.githubId])).rows[0];
    if(previous?.role==="owner"&&role!=="owner") {
      const count=await client.query<{count:string}>("SELECT count(*)::text FROM website_roles WHERE role='owner' AND revoked_at IS NULL");
      if(Number(count.rows[0]!.count)<=1) throw new AdminError("LAST_OWNER",409,"不能撤销或降级最后一位站长");
    }
    if(role) await client.query(`INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login,role=EXCLUDED.role,granted_by=EXCLUDED.granted_by,
      granted_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,reason=EXCLUDED.reason`,[target.githubId,target.login,role,actorId,reason]);
    else await client.query("UPDATE website_roles SET revoked_at=clock_timestamp(),revoked_by=$2,reason=$3 WHERE github_id=$1 AND revoked_at IS NULL",[target.githubId,actorId,reason]);
    await auditAdmin(client,{githubId:actorId,login:actor.login},target,role?"role.set":"role.revoke",reason,{before:previous?.role??null,after:role});
  });
}
export async function listWebsiteRoles() {
  const result=await getDbPool().query<{github_id:string;login:string;role:WebsiteRole;granted_by:string;granted_at:Date;revoked_at:Date|null;reason:string}>(
    "SELECT github_id::text,login,role,granted_by::text,granted_at,revoked_at,reason FROM website_roles ORDER BY granted_at DESC");
  return result.rows.map(r=>({githubId:r.github_id,login:r.login,role:r.role,grantedBy:r.granted_by,grantedAt:r.granted_at.toISOString(),revokedAt:r.revoked_at?.toISOString()??null,reason:r.reason}));
}
export async function listAdminAudit() {
  const result=await getDbPool().query<{id:string;actor_login:string;target_login:string;action:string;reason:string;created_at:Date}>(
    "SELECT id::text,actor_login,target_login,action,reason,created_at FROM website_admin_audit ORDER BY id DESC LIMIT 200");
  return result.rows.map(r=>({id:r.id,actorLogin:r.actor_login,targetLogin:r.target_login,action:r.action,reason:r.reason,createdAt:r.created_at.toISOString()}));
}

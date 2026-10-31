// Trusted server CLI. Initial owner bootstrap is deliberately absent from HTTP.
import pg from 'pg';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{actor:{type:'string'},'actor-login':{type:'string'},users:{type:'string'},role:{type:'string',default:'admin'},reason:{type:'string'},bootstrap:{type:'boolean',default:false}}});
const actor=values.actor,actorLogin=values['actor-login'],role=values.role;
const logins=(values.users??'').split(',').map(v=>v.trim()).filter(Boolean);
if(!/^[1-9]\d{0,17}$/.test(actor??'')||!actorLogin||!logins.length||logins.length>20||!['owner','admin','revoke'].includes(role)||!values.reason||values.reason.trim().length<5||values.reason.length>1000)throw new Error('Invalid role command');
if(values.bootstrap&&(role!=='owner'||logins.length!==1||logins[0].toLowerCase()!==actorLogin.toLowerCase()))throw new Error('Bootstrap must initialize the acting account as the first owner');
if(!process.env.DATABASE_URL?.trim())throw new Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
  // Resolve all accounts before writing anything; names are input, not a source-code allowlist.
  const users=[];
  for(const login of logins){
    if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login))throw new Error('Invalid GitHub login');
    const response=await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`,{headers:{Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Cannot resolve GitHub user ${login}`);
    const identity=await response.json();
    if(identity.type!=='User'||!Number.isSafeInteger(identity.id)||identity.id<=0||typeof identity.login!=='string')throw new Error('Expected a human GitHub identity');
    users.push({id:String(identity.id),login:identity.login});
  }
  if(values.bootstrap&&users[0].id!==actor)throw new Error('Bootstrap identity does not match actor');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(7983161)');
    const owners=(await client.query("SELECT github_id::text FROM website_roles WHERE role='owner' AND revoked_at IS NULL")).rows;
    if(values.bootstrap){if(owners.length)throw new Error('An owner already exists; use authenticated role management');}
    else if(!owners.some(r=>r.github_id===actor))throw new Error('Acting account is not a website owner');
    for(const user of users){
      const before=(await client.query('SELECT role FROM website_roles WHERE github_id=$1 AND revoked_at IS NULL',[user.id])).rows[0]?.role??null;
      if(before==='owner'&&role!=='owner'){
        const remaining=(await client.query("SELECT count(*)::int AS n FROM website_roles WHERE role='owner' AND revoked_at IS NULL")).rows[0].n;
        if(remaining<=1)throw new Error('Cannot remove the last owner');
      }
      if(role==='revoke')await client.query('UPDATE website_roles SET revoked_at=clock_timestamp(),revoked_by=$2,reason=$3 WHERE github_id=$1 AND revoked_at IS NULL',[user.id,actor,values.reason.trim()]);
      else await client.query(`INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login,role=EXCLUDED.role,granted_by=EXCLUDED.granted_by,granted_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL,reason=EXCLUDED.reason`,[user.id,user.login,role,actor,values.reason.trim()]);
      await client.query(`INSERT INTO website_admin_audit(actor_github_id,actor_login,target_github_id,target_login,action,reason,details)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,[actor,actorLogin,user.id,user.login,values.bootstrap?'role.bootstrap':role==='revoke'?'role.revoke':'role.set',values.reason.trim(),JSON.stringify({before,after:role==='revoke'?null:role})]);
    }
    await client.query('COMMIT');
    const result=await client.query('SELECT github_id::text,login,role,revoked_at IS NULL AS active FROM website_roles WHERE github_id=ANY($1::bigint[]) ORDER BY login',[users.map(u=>u.id)]);
    console.log(JSON.stringify({roles:result.rows}));
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}finally{await pool.end()}

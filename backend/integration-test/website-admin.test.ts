import {randomUUID,createHash} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {getDbPool} from "../src/db/index.js";
import {getWebsiteRole,setWebsiteRole} from "../src/auth/roles.js";
import {WebsiteAuthService} from "../src/auth/website-session.js";
import {ScoreAdjustmentService,getScoreAdjustments} from "../src/analytics/adjustments.js";
import {AnalyticsService} from "../src/analytics/index.js";
const pool=getDbPool();const owner='881001',admin='881002',target='881003',secondOwner='881004';const service=new ScoreAdjustmentService();
const reason='测试管理员授权及调分记录';
beforeAll(async()=>{
  await pool.query("TRUNCATE website_roles,website_admin_audit,contributor_score_adjustments,contributors RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES ($1,'owner','owner',$1,$2)",[owner,reason]);
  await pool.query("INSERT INTO contributors(github_id,login,is_bot,enrolled_at) VALUES ($1,'ledger-target',FALSE,now()),(881005,'bot',TRUE,now())",[target]);
});
afterAll(async()=>{await pool.end()});
describe("persistent website roles and score ledger",()=>{
  it("has no implicit default admin, reads database roles and revokes existing sessions",async()=>{
    expect(await getWebsiteRole('333234233')).toBeNull();
    await setWebsiteRole(owner,{githubId:admin,login:'reviewer'},'admin',reason);
    const token='x'.repeat(43);await pool.query("INSERT INTO website_sessions(token_hash,github_id,login,csrf_token,expires_at) VALUES ($1,$2,'reviewer','csrf',now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),admin]);
    const auth=new WebsiteAuthService();expect(await auth.getSession(token)).toMatchObject({isAdmin:false,role:'admin',memberId:null});
    await expect(setWebsiteRole(admin,{githubId:admin,login:'reviewer'},'owner',reason)).rejects.toMatchObject({status:403});
    await setWebsiteRole(owner,{githubId:admin,login:'reviewer'},null,reason);expect(await auth.getSession(token)).toBeNull();
    await expect(service.adjust(admin,{githubId:target,delta:1,reason,requestId:randomUUID()})).rejects.toMatchObject({status:403});
    await setWebsiteRole(owner,{githubId:admin,login:'reviewer'},'admin',reason);
  });
  it("protects the last owner including concurrent demotions",async()=>{
    await expect(setWebsiteRole(owner,{githubId:owner,login:'owner'},'admin',reason)).rejects.toMatchObject({code:'LAST_OWNER'});
    await setWebsiteRole(owner,{githubId:secondOwner,login:'other-owner'},'owner',reason);
    const results=await Promise.allSettled([setWebsiteRole(owner,{githubId:owner,login:'owner'},'admin',reason),setWebsiteRole(secondOwner,{githubId:secondOwner,login:'other-owner'},'admin',reason)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(Number((await pool.query("SELECT count(*)::text FROM website_roles WHERE role='owner' AND revoked_at IS NULL")).rows[0].count)).toBe(1);
  });
  it("applies concurrent retries once, audits, ranks zero-activity contributors and preserves signed totals",async()=>{
    await pool.query("UPDATE website_roles SET role='owner' WHERE github_id=$1",[admin]);
    const input={githubId:target,delta:-10,reason,requestId:randomUUID()};
    const [a,b]=await Promise.all([service.adjust(admin,input),service.adjust(admin,input)]);expect(a.id).toBe(b.id);
    await expect(service.adjust(admin,{...input,delta:20})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await expect(service.adjust(admin,{...input,githubId:'881005',requestId:randomUUID()})).rejects.toMatchObject({code:'CONTRIBUTOR_NOT_FOUND'});
    const current=new AnalyticsService(pool,()=>new Date(Date.now()+2000));
    const board=await current.getContributorLeaderboard({range:'all',metric:'score',limit:50});expect(board.find(r=>r.login==='ledger-target')).toMatchObject({score:-10,adjustmentScore:-10,commits:0,prs:0,issues:0});
    expect(await current.getContributorDetail('ledger-target','all')).toMatchObject({score:-10,adjustmentScore:-10});
    const audit=(await pool.query("SELECT * FROM website_admin_audit WHERE action='score.adjust'")).rows;expect(audit).toHaveLength(1);expect(audit[0].actor_github_id).toBe(admin);expect(audit[0].reason).toBe(reason);
    const reverseKey=randomUUID();const undone=await service.reverse(admin,a.id,'撤销测试中错误扣除的积分',reverseKey);expect(undone.delta).toBe(10);expect(undone.reversesId).toBe(a.id);
    expect((await service.reverse(admin,a.id,'撤销测试中错误扣除的积分',reverseKey)).id).toBe(undone.id);
    await expect(service.reverse(admin,a.id,reason,randomUUID())).rejects.toMatchObject({code:'ALREADY_REVERSED'});
    expect(await current.getContributorDetail('ledger-target','all')).toMatchObject({score:0,adjustmentScore:0});
    expect((await service.list(target))).toHaveLength(2);
    const id=(await pool.query('SELECT id::text FROM contributors WHERE github_id=$1',[target])).rows[0].id;
    const at=(await pool.query('SELECT created_at FROM contributor_score_adjustments WHERE id=$1',[a.id])).rows[0].created_at as Date;
    const until=await getScoreAdjustments(pool,null,at.toISOString());expect(until.has(id)).toBe(false);
    const after=await getScoreAdjustments(pool,at.toISOString(),new Date(Date.now()+2000).toISOString());expect(after.get(id)).toBe(0);
    expect((await pool.query('SELECT count(*)::text FROM commits')).rows[0].count).toBe('0');
  });
});

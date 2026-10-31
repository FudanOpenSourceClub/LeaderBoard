import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from "vitest";
import {getDbPool} from "../src/db/index.js";
import {WebsiteAuthService} from "../src/auth/website-session.js";
import {ProjectProposalService} from "../src/projects/proposals.js";
import {ProjectNotificationWorker} from "../src/projects/notifications.js";
const pool=getDbPool();let memberId:string;let identityId=777001;
const config={clientId:"fixture",clientSecret:"fixture-not-a-real-secret",callbackUrl:"https://example.test/api/v1/auth/github/callback"};
beforeAll(async()=>{
  await pool.query("TRUNCATE website_sessions,website_login_states,project_notification_outbox,project_proposals,members,github_accounts RESTART IDENTITY CASCADE");
  const result=await pool.query<{id:string}>(`INSERT INTO members(email_fingerprint,email_domain,verification_status,verified_at,last_reverified_at,student_fingerprint,registration_github_id)
    VALUES ($1,'fudan.edu.cn','verified',now(),now(),$2,777001) RETURNING id::text`,['a'.repeat(64),'b'.repeat(64)]);memberId=result.rows[0]!.id;
  await pool.query("INSERT INTO github_accounts(github_id,login) VALUES (777001,'registered-user')");
  await pool.query("INSERT INTO member_github_accounts(member_id,github_id,is_primary) VALUES ($1,777001,TRUE)",[memberId]);
});
afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await pool.end()});
function mockOAuth(){vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).includes('access_token')?{access_token:'fixture'}:{id:identityId,login:identityId===333234233?'owner':'registered-user',avatar_url:null}),{status:200})))}
describe("website sessions and repository review",()=>{
  it("requires the original browser nonce, denies unregistered identities, and recognizes admin by ID",async()=>{
    mockOAuth();const auth=new WebsiteAuthService(config);
    await pool.query("INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES (333234233,'owner','owner',333234233,'integration fixture') ON CONFLICT(github_id) DO UPDATE SET role='owner',revoked_at=NULL");
    const started=await auth.startLogin('/projects');const state=new URL(started.authorizeUrl).searchParams.get('state')!;
    await expect(auth.completeLogin('code',state,'x'.repeat(43))).rejects.toMatchObject({code:'INVALID_LOGIN'});
    identityId=777001;const loggedIn=await auth.completeLogin('code',state,started.browserToken);
    const user=await auth.getSession(loggedIn.sessionToken);expect(user).toMatchObject({githubId:'777001',memberId,isAdmin:false});
    await expect(auth.completeLogin('code',state,started.browserToken)).rejects.toMatchObject({code:'INVALID_LOGIN'});
    const other=await auth.startLogin('/admin');identityId=777002;
    await expect(auth.completeLogin('code',new URL(other.authorizeUrl).searchParams.get('state')!,other.browserToken)).rejects.toMatchObject({code:'REGISTRATION_REQUIRED'});
    const owner=await auth.startLogin('//evil.example');identityId=333234233;
    const admin=await auth.completeLogin('code',new URL(owner.authorizeUrl).searchParams.get('state')!,owner.browserToken);
    expect(admin.returnPath).toBe('/projects');expect(await auth.getSession(admin.sessionToken)).toMatchObject({githubId:'333234233',isAdmin:true,memberId:null});
  });
  it("persists the application and notification atomically, retries mail, and publishes only after approval",async()=>{
    const lookup=vi.fn(async(url:string)=>({githubId:url.endsWith('/two')?'990002':'990001',fullName:url.endsWith('/two')?'fixture/two':'fixture/one',name:url.endsWith('/two')?'two':'one',url}));
    const service=new ProjectProposalService(lookup);
    const input={projectUrl:'https://github.com/fixture/one',labName:'复旦大学示例实验室',notes:'申请的原始证明材料，仅供管理员审核，不应直接作为公开简介。'};
    const application=await service.submit(input,memberId);
    await expect(service.submit(input,memberId)).rejects.toMatchObject({code:'PROJECT_ALREADY_SUBMITTED'});
    expect(await service.projects()).toEqual([]);
    lookup.mockResolvedValueOnce({githubId:'990099',fullName:'fixture/one',name:'one',url:input.projectUrl});
    await expect(service.review(application.id,{decision:'approve',reviewNotes:'',description:'仓库地址被另一个仓库占用后不能直接批准。'},'333234233')).rejects.toMatchObject({code:'REPOSITORY_CHANGED'});
    expect(await service.projects()).toEqual([]);
    const sender={sendMail:vi.fn().mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValue(undefined)};
    const worker=new ProjectNotificationWorker(sender,'owner@example.test','https://example.test');
    await worker.runOnce();let outbox=(await pool.query('SELECT * FROM project_notification_outbox WHERE proposal_id=$1',[application.id])).rows[0];
    expect(outbox.sent_at).toBeNull();expect(outbox.attempt_count).toBe(1);
    await pool.query('UPDATE project_notification_outbox SET next_attempt_at=now() WHERE proposal_id=$1',[application.id]);
    await worker.runOnce();await worker.runOnce();expect(sender.sendMail).toHaveBeenCalledTimes(2);
    expect(sender.sendMail.mock.calls[1]?.[0]).toMatchObject({to:'owner@example.test',subject:expect.stringContaining(String(application.id)),text:expect.stringContaining(input.notes)});
    const list=await service.list();expect(list[0]).toMatchObject({id:application.id,status:'pending',submitterLogin:'registered-user',notificationSent:true});
    const description='这是由管理员确认后公开展示的项目简介。';
    await service.review(application.id,{decision:'approve',reviewNotes:'确认收录',description},'333234233');
    expect(await service.projects()).toEqual([expect.objectContaining({repo:'fixture/one',description})]);
    expect(JSON.stringify(await service.projects())).not.toContain(input.notes);
    await expect(service.review(application.id,{decision:'reject',reviewNotes:''},'333234233')).rejects.toMatchObject({code:'PROPOSAL_ALREADY_REVIEWED'});
    const second=await service.submit({...input,projectUrl:'https://github.com/fixture/two'},memberId);
    await service.review(second.id,{decision:'reject',reviewNotes:'暂不收录'},'333234233');
    expect(await service.projects()).toHaveLength(1);
  });
});

import {describe,expect,it,vi} from "vitest";
import request from "supertest";
import {createApp} from "../src/app.js";
import {createApiRouter} from "../src/api/router.js";
import type {WebsiteUser} from "../src/auth/website-session.js";
const requestId="12345678-1234-4234-8234-123456789abc";
const admin:WebsiteUser={githubId:"7001",login:"reviewer",memberId:null,isAdmin:true,role:"owner",csrfToken:"fixture-csrf"};
function setup(user:WebsiteUser|null=admin) {
  const result={id:"1",githubId:"8001",login:"contributor",delta:-10,reason:"确认贡献重复计分",actorLogin:"reviewer",createdAt:"2026-10-31T12:00:00.000Z",requestId,reversesId:null,reversed:false};
  const scores={contributors:vi.fn().mockResolvedValue([{githubId:"8001",login:"contributor"}]),list:vi.fn().mockResolvedValue([]),adjust:vi.fn().mockResolvedValue(result),reverse:vi.fn().mockResolvedValue({...result,id:"2",delta:10,reversesId:"1"})};
  const roles=vi.fn().mockResolvedValue([]),setRole=vi.fn(),resolve=vi.fn().mockResolvedValue({githubId:"8002",login:"new-admin"});
  const app=createApp({apiRouter:createApiRouter({
    analytics:{getGroups:vi.fn(),getOrganizationActivitySummary:vi.fn(),getRepositoryStats:vi.fn(),getContributorLeaderboard:vi.fn(),getContributorDetail:vi.fn()},
    websiteAuth:{getSession:async()=>user,fromRegistration:async()=>null,getRegistrationIdentity:async()=>null,startLogin:vi.fn(),completeLogin:vi.fn()},
    websiteAdmin:{scores,roles,setRole,resolve,audit:vi.fn().mockResolvedValue([])},
  })});
  return {app,scores,roles,setRole,resolve};
}
const payload={githubId:"8001",delta:-10,reason:"确认贡献重复计分",requestId};
describe("website admin access matrix",()=>{
  it.each([null,{...admin,isAdmin:false,role:null,memberId:"12"}])("denies unauthenticated/ordinary users before calling services",async user=>{
    const {app,scores,setRole}=setup(user as WebsiteUser|null);
    for(const path of ["roles","score-adjustments","audit","contributors?query=reviewer"]){await request(app).get('/api/v1/admin/'+path).expect(user?403:401)}
    await request(app).post('/api/v1/admin/score-adjustments').send({...payload,isAdmin:true}).expect(user?403:401);
    expect(scores.adjust).not.toHaveBeenCalled();expect(setRole).not.toHaveBeenCalled();
  });
  it("requires CSRF on adjustments, reversals and role changes",async()=>{
    const {app,scores,setRole}=setup({...admin,role:"owner"});
    for(const path of ["score-adjustments","score-adjustments/1/reverse","roles"]){await request(app).post('/api/v1/admin/'+path).send(payload).expect(403)}
    expect(scores.adjust).not.toHaveBeenCalled();expect(scores.reverse).not.toHaveBeenCalled();expect(setRole).not.toHaveBeenCalled();
  });
  it("allows admin score changes, rejects forged actor and zero/fractional values",async()=>{
    const {app,scores}=setup();
    for(const body of [{...payload,actorId:"spoofed"},{...payload,delta:0},{...payload,delta:0.5},{...payload,reason:"短"},{...payload,delta:100001}]) {
      await request(app).post('/api/v1/admin/score-adjustments').set('X-CSRF-Token',admin.csrfToken).send(body).expect(400);
    }
    await request(app).post('/api/v1/admin/score-adjustments').set('X-CSRF-Token',admin.csrfToken).send(payload).expect(201);
    expect(scores.adjust).toHaveBeenCalledExactlyOnceWith("7001",payload);
    const r=await request(app).get('/api/v1/admin/score-adjustments').expect(200);expect(r.headers['cache-control']).toBe('no-store');
  });
  it("denies admin privilege escalation; owner resolves target identity on the server",async()=>{
    const ordinary=setup({...admin,isAdmin:false,role:"admin"});await request(ordinary.app).post('/api/v1/admin/roles').set('X-CSRF-Token',admin.csrfToken).send({githubLogin:'new-admin',role:'owner',reason:'新增站长授权说明'}).expect(403);
    expect(ordinary.setRole).not.toHaveBeenCalled();expect(ordinary.resolve).not.toHaveBeenCalled();
    const owner=setup({...admin,role:'owner'});
    await request(owner.app).post('/api/v1/admin/roles').set('X-CSRF-Token',admin.csrfToken).send({githubLogin:'new-admin',role:'admin',reason:'新增管理员审核授权'}).expect(200);
    expect(owner.setRole).toHaveBeenCalledWith('7001',{githubId:'8002',login:'new-admin'},'admin','新增管理员审核授权');
  });
  it("validates reversal paths and requires an audit reason",async()=>{
    const {app,scores}=setup();
    await request(app).post('/api/v1/admin/score-adjustments/1/reverse').set('X-CSRF-Token',admin.csrfToken).send({reason:'撤销误操作的扣分',requestId}).expect(201);
    expect(scores.reverse).toHaveBeenCalledWith('7001','1','撤销误操作的扣分',requestId);
    await request(app).post('/api/v1/admin/score-adjustments/no/reverse').set('X-CSRF-Token',admin.csrfToken).send({reason:'撤销误操作的扣分',requestId}).expect(400);
  });
});

import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {createApiRouter} from '../src/api/router.js';
import type {WebsiteUser} from '../src/auth/website-session.js';
const user:WebsiteUser={githubId:'2001',login:'alice',memberId:'1',isAdmin:false,role:null,csrfToken:'csrf-test'};
const input={category:'contributor',repository:'org/repo',reason:'本人的有效贡献已经被采用',evidenceUrls:['https://github.com/org/repo/pull/1']};
function setup(identity:WebsiteUser|null=user){
  const application={...input,id:'1',githubId:user.githubId,login:'alice',status:'pending',createdAt:'2026-11-09T00:00:00.000Z',reviewedAt:null,reviewerLogin:null,reviewNote:'',tagId:null};
  const service={apply:vi.fn().mockResolvedValue(application),list:vi.fn().mockResolvedValue([application]),review:vi.fn().mockResolvedValue({...application,status:'approved',reviewedAt:'2026-11-09T01:00:00.000Z',reviewerLogin:'reviewer',tagId:'1'})};
  const analytics={getGroups:vi.fn(),getOrganizationActivitySummary:vi.fn(),getRepositoryStats:vi.fn(),getContributorLeaderboard:vi.fn(),getContributorDetail:vi.fn()};
  const app=createApp({apiRouter:createApiRouter({analytics,outstandingApplications:service,websiteAuth:{getSession:async()=>identity,fromRegistration:async()=>null,getRegistrationIdentity:async()=>null,startLogin:vi.fn(),completeLogin:vi.fn()}})});
  return {app,service,analytics};
}
describe('Outstanding self applications and login gate',()=>{
  it('blocks all content APIs before accessing their data while leaving session discovery public',async()=>{
    const {app,service,analytics}=setup(null);
    for(const path of ['projects','contributors/leaderboard','contributors/outstanding','contributors/alice','groups','organization/summary','organization/repositories','sync/status','outstanding-applications','admin/outstanding-applications']){
      const response=await request(app).get('/api/v1/'+path).expect(401);expect(response.body.error.code).toBe('LOGIN_REQUIRED');expect(response.headers['cache-control']).toBe('no-store');
    }
    await request(app).get('/api/v1/auth/session').expect(200,{authenticated:false});
    expect(service.list).not.toHaveBeenCalled();expect(analytics.getContributorLeaderboard).not.toHaveBeenCalled();
  });
  it('binds submissions and personal history to the session, never a client-selected identity',async()=>{
    const {app,service}=setup();
    await request(app).get('/api/v1/outstanding-applications?githubId=9999').expect(200);
    expect(service.list).toHaveBeenCalledExactlyOnceWith(user.githubId);
    for(const identity of [{githubId:'9999'},{login:'other'},{contributorId:'9999'},{memberId:'9999'}])await request(app).post('/api/v1/outstanding-applications').set('X-CSRF-Token',user.csrfToken).send({...input,...identity}).expect(400);
    expect(service.apply).not.toHaveBeenCalled();
    await request(app).post('/api/v1/outstanding-applications').set('X-CSRF-Token',user.csrfToken).send(input).expect(201);
    expect(service.apply).toHaveBeenCalledExactlyOnceWith(user.githubId,input);
  });
  it('requires CSRF and matching repository evidence',async()=>{
    const {app,service}=setup();await request(app).post('/api/v1/outstanding-applications').send(input).expect(403);
    await request(app).post('/api/v1/outstanding-applications').set('X-CSRF-Token',user.csrfToken).send({...input,repository:'other/repo'}).expect(400);
    expect(service.apply).not.toHaveBeenCalled();
  });
  it('restricts review to current reviewers and validates decision, CSRF and rejection reasons',async()=>{
    const ordinary=setup();await request(ordinary.app).get('/api/v1/admin/outstanding-applications').expect(403);
    await request(ordinary.app).post('/api/v1/admin/outstanding-applications/1/review').set('X-CSRF-Token',user.csrfToken).send({decision:'approved'}).expect(403);
    expect(ordinary.service.review).not.toHaveBeenCalled();
    const {app,service}=setup({...user,githubId:'2002',login:'reviewer',role:'admin'});
    await request(app).get('/api/v1/admin/outstanding-applications').expect(200);
    expect(service.list).toHaveBeenCalledExactlyOnceWith();
    await request(app).post('/api/v1/admin/outstanding-applications/1/review').send({decision:'approved'}).expect(403);
    await request(app).post('/api/v1/admin/outstanding-applications/1/review').set('X-CSRF-Token',user.csrfToken).send({decision:'rejected'}).expect(400);
    await request(app).post('/api/v1/admin/outstanding-applications/1/review').set('X-CSRF-Token',user.csrfToken).send({decision:'approved'}).expect(200);
    expect(service.review).toHaveBeenCalledExactlyOnceWith('2002','1',{decision:'approved',note:''});
  });
});

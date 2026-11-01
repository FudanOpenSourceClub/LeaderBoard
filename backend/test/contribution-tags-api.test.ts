import {describe,it,expect,vi} from "vitest";
import request from "supertest";
import {createApp} from "../src/app.js";
import {createApiRouter} from "../src/api/router.js";
import type {WebsiteUser} from "../src/auth/website-session.js";
const tagger:WebsiteUser={githubId:'1001',login:'curator',memberId:null,role:'admin',isAdmin:false,csrfToken:'csrf-fixture'};
const input={githubId:'1002',category:'contributor',evidenceUrls:['https://github.com/org/repo/pull/1'],reason:'已核对真实贡献记录',confirmed:true};
function setup(user:WebsiteUser|null=tagger){
  const tag={id:'1',githubId:'1002',login:'contributor',category:'contributor',repository:'org/repo',evidenceUrls:input.evidenceUrls,reason:input.reason,actorLogin:'curator',createdAt:'2026-10-31T12:00:00.000Z',revokedAt:null};
  const tags={add:vi.fn().mockResolvedValue(tag),revoke:vi.fn().mockResolvedValue({...tag,revokedAt:'2026-11-01T00:00:00.000Z'}),list:vi.fn().mockResolvedValue([tag]),search:vi.fn().mockResolvedValue([{githubId:'1002',login:'contributor'}])};
  const scores={contributors:vi.fn(),list:vi.fn(),adjust:vi.fn(),reverse:vi.fn()},roles=vi.fn(),review=vi.fn();
  const app=createApp({apiRouter:createApiRouter({analytics:{getGroups:vi.fn(),getOrganizationActivitySummary:vi.fn(),getRepositoryStats:vi.fn(),getContributorLeaderboard:vi.fn(),getContributorDetail:vi.fn()},websiteAuth:{getSession:async()=>user,startLogin:vi.fn(),completeLogin:vi.fn(),getRegistrationIdentity:vi.fn(),fromRegistration:async()=>null},contributionTags:tags,websiteAdmin:{roles,setRole:vi.fn(),audit:vi.fn(),resolve:vi.fn(),scores},projectReview:{projects:vi.fn(),list:vi.fn(),review}})});
  return {app,tags,scores,roles,review};
}
describe('tag-only permissions',()=>{
  it('lets a delegated curator add labels but denies every privileged route',async()=>{
    const {app,tags,scores,roles,review}=setup();
    await request(app).get('/api/v1/admin/tag-contributors?query=contributor').expect(200);
    await request(app).get('/api/v1/admin/contribution-tags').expect(200);
    await request(app).post('/api/v1/admin/contribution-tags').set('X-CSRF-Token',tagger.csrfToken).send(input).expect(201);
    expect(tags.add).toHaveBeenCalledExactlyOnceWith(tagger.githubId,input);
    for(const path of ['roles','audit','score-adjustments','contributors?query=contributor','project-proposals'])await request(app).get('/api/v1/admin/'+path).expect(403);
    for(const path of ['roles','score-adjustments','score-adjustments/1/reverse','project-proposals/1/review','contribution-tags/1/revoke'])await request(app).post('/api/v1/admin/'+path).set('X-CSRF-Token',tagger.csrfToken).send(input).expect(403);
    expect(scores.adjust).not.toHaveBeenCalled();expect(roles).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();expect(tags.revoke).not.toHaveBeenCalled();
    const session=await request(app).get('/api/v1/auth/session').expect(200);expect(session.body).toMatchObject({isAdmin:false,canTag:true,role:'admin'});
  });
  it.each([null,{...tagger,role:null,memberId:'1'}])('blocks anonymous and ordinary users',async user=>{
    const {app,tags}=setup(user as WebsiteUser|null);await request(app).post('/api/v1/admin/contribution-tags').set('X-CSRF-Token',tagger.csrfToken).send(input).expect(user?403:401);expect(tags.add).not.toHaveBeenCalled();
  });
  it('requires CSRF and rejects forged authority, unconfirmed or malformed evidence',async()=>{
    const {app,tags}=setup();await request(app).post('/api/v1/admin/contribution-tags').send(input).expect(403);
    for(const body of [{...input,role:'owner'},{...input,actorId:'1003'},{...input,confirmed:false},{...input,evidenceUrls:['not a url']},{...input,category:'committer'},{...input,category:'maintainer'}])await request(app).post('/api/v1/admin/contribution-tags').set('X-CSRF-Token',tagger.csrfToken).send(body).expect(400);
    expect(tags.add).not.toHaveBeenCalled();
  });
  it('allows only an owner to revoke a tag',async()=>{
    const {app,tags}=setup({...tagger,isAdmin:true,role:'owner'});await request(app).post('/api/v1/admin/contribution-tags/1/revoke').set('X-CSRF-Token',tagger.csrfToken).send({reason:'证据需要纠正请撤销'}).expect(200);expect(tags.revoke).toHaveBeenCalledExactlyOnceWith('1001','1','证据需要纠正请撤销');
  });
});

import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {getDbPool} from '../src/db/index.js';
import {OutstandingApplicationService} from '../src/analytics/outstanding-applications.js';
import {getOutstandingBoards} from '../src/analytics/contribution-tags.js';
import {AnalyticsService} from '../src/analytics/index.js';
const pool=getDbPool(),service=new OutstandingApplicationService();
const applicant='997001',reviewer='997002',other='997003';
const input={category:'contributor' as const,repository:'org/repo',evidenceUrls:['https://github.com/org/repo/pull/1'],reason:'本人有效贡献已经被项目采用'};
beforeAll(async()=>{
  await pool.query('TRUNCATE contributors,website_roles,website_admin_audit RESTART IDENTITY CASCADE');
  await pool.query("INSERT INTO contributors(github_id,login,enrolled_at,is_bot) VALUES($1,'applicant',now(),FALSE),($2,'other',now(),FALSE)",[applicant,other]);
  await pool.query("INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES($1,'reviewer','admin',$1,'测试审核员授权'),($2,'applicant','owner',$2,'测试站长也不能自审')",[reviewer,applicant]);
});
afterAll(async()=>{await pool.end()});
describe('persistent Outstanding application review',()=>{
  it('isolates personal history and awards exactly once after concurrent approvals',async()=>{
    const attempts=await Promise.allSettled([service.apply(applicant,input),service.apply(applicant,input)]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const [application]=(await service.list(applicant));expect(application).toMatchObject({status:'pending',githubId:applicant,tagId:null});
    expect(await service.list(other)).toEqual([]);
    expect((await getOutstandingBoards()).boards.every(b=>b.people.length===0)).toBe(true);
    expect((await new AnalyticsService(pool).getContributorDetail('applicant','all'))?.outstandingScore).toBe(0);
    await expect(service.review(applicant,application!.id,{decision:'approved',note:''})).rejects.toMatchObject({code:'SELF_REVIEW_DENIED'});
    await expect(service.review(other,application!.id,{decision:'approved',note:''})).rejects.toMatchObject({status:403});
    const reviews=await Promise.allSettled([service.review(reviewer,application!.id,{decision:'approved',note:''}),service.review(reviewer,application!.id,{decision:'approved',note:''})]);
    expect(reviews.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await service.list(applicant))[0]).toMatchObject({status:'approved',reviewerLogin:'reviewer',tagId:expect.any(String)});
    expect((await pool.query('SELECT * FROM contribution_tags')).rows).toHaveLength(1);
    expect((await new AnalyticsService(pool).getContributorDetail('applicant','all'))).toMatchObject({score:15,outstandingScore:15});
    expect((await getOutstandingBoards()).boards[0]!.people[0]).toMatchObject({login:'applicant',score:15});
    await expect(service.apply(applicant,input)).rejects.toMatchObject({code:'TAG_EXISTS'});
  });
  it('rejects without awarding and permits a corrected reapplication',async()=>{
    const next={...input,repository:'org/another',evidenceUrls:['https://github.com/org/another/pull/2']};
    const pending=await service.apply(other,next);
    await service.review(reviewer,pending.id,{decision:'rejected',note:'证据未被项目确认，请补充'});
    expect((await service.list(other))[0]).toMatchObject({status:'rejected',tagId:null});
    expect((await pool.query('SELECT * FROM contribution_tags')).rows).toHaveLength(1);
    expect((await service.apply(other,next)).status).toBe('pending');
  });
  it('rolls back approval when contribution evidence fails and rechecks revoked reviewer roles',async()=>{
    const pending=await service.apply(other,{...input,category:'committer',evidenceUrls:[1,2,3].map(n=>'https://github.com/org/repo/pull/'+n)});
    await expect(service.review(reviewer,pending.id,{decision:'approved',note:''})).rejects.toMatchObject({code:'COMMITTER_EVIDENCE_REQUIRED'});
    expect((await service.list(other)).find(a=>a.id===pending.id)).toMatchObject({status:'pending',tagId:null});
    await pool.query('UPDATE website_roles SET revoked_at=now() WHERE github_id=$1',[reviewer]);
    await expect(service.review(reviewer,pending.id,{decision:'rejected',note:'管理员已被撤权'})).rejects.toMatchObject({status:403});
  });
});

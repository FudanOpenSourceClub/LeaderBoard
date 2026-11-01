import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {getDbPool} from "../src/db/index.js";
import {ContributionTagService,getTagMap} from "../src/analytics/contribution-tags.js";
import {ScoreAdjustmentService} from "../src/analytics/adjustments.js";
import {AnalyticsService} from "../src/analytics/index.js";
const pool=getDbPool(),service=new ContributionTagService();const owner='998001',curator='998002',target='998003';
const base={githubId:target,category:'contributor' as const,evidenceUrls:['https://github.com/org/repo/pull/1'],reason:'真实贡献已经采用并核对',confirmed:true as const};
let targetId:string;
beforeAll(async()=>{
  await pool.query('TRUNCATE contributors,website_roles,website_admin_audit RESTART IDENTITY CASCADE');
  await pool.query("INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES($1,'owner','owner',$1,'integration fixture'),($2,'curator','admin',$1,'integration fixture')",[owner,curator]);
  targetId=(await pool.query("INSERT INTO contributors(github_id,login,is_bot,enrolled_at,public_synced_at) VALUES($1,'target',FALSE,now(),now()) RETURNING id::text",[target])).rows[0].id;
});afterAll(async()=>{await pool.end()});
describe('contribution categories persist separately from permissions and points',()=>{
  it('prevents self labeling, score writes, duplicate concurrent labels and preserves revocation history',async()=>{
    await expect(service.add(curator,{...base,githubId:curator})).rejects.toMatchObject({code:'SELF_TAG_DENIED'});
    await expect(new ScoreAdjustmentService().adjust(curator,{githubId:target,delta:10,reason:base.reason,requestId:'01234567-1234-4234-8234-123456789abc'})).rejects.toMatchObject({status:403});
    const attempts=await Promise.allSettled([service.add(curator,base),service.add(curator,base)]);expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const tags=(await getTagMap(pool,[targetId])).get(targetId)!;expect(tags).toHaveLength(1);
    await expect(service.revoke(curator,tags[0]!.id,'错误标签需要撤销纠正')).rejects.toMatchObject({status:403});
    await service.revoke(owner,tags[0]!.id,'错误标签需要撤销纠正');expect((await getTagMap(pool,[targetId])).get(targetId)).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM contribution_tags')).rows[0].n).toBe(1);
    expect((await pool.query("SELECT action FROM website_admin_audit ORDER BY id")).rows.map(r=>r.action)).toEqual(['tag.add','tag.revoke']);
  });
  it('verifies collected merged PRs across two weeks and exposes measurable profile components',async()=>{
    const input={...base,category:'committer' as const,evidenceUrls:[1,2,3].map(n=>'https://github.com/org/repo/pull/'+n)};
    await expect(service.add(curator,input)).rejects.toMatchObject({code:'COMMITTER_EVIDENCE_REQUIRED'});
    const now=Date.now();for(const [i,days] of [22,12,2].entries())await pool.query(`INSERT INTO contributor_public_activities(contributor_id,kind,repository,repository_github_id,identifier,occurred_at,merged_at,title,html_url) VALUES($1,'pull_request','org/repo',999,$2,$3,$4,'Useful change',$5)`,[targetId,String(i+1),new Date(now-days*86400000),new Date(now-(days-1)*86400000),input.evidenceUrls[i]]);
    expect(await service.add(curator,input)).toMatchObject({category:'committer',githubId:target});
    const analytics=new AnalyticsService(pool,()=>new Date(now+1000));const detail=await analytics.getContributorDetail('target','90d');
    expect(detail?.contributionProfile).toMatchObject({submittedPrs:3,mergedPrs:3,mergedSubmittedPrs:3,prMergeRate:100,activeDays:3,repositories:1});
    expect(detail?.communityTags).toHaveLength(1);expect(detail?.score).toBe(0); // Tags never add points; repository is not on PR whitelist.
    expect((await analytics.getContributorLeaderboard({range:'all',metric:'score',limit:10}))[0]?.communityTags).toHaveLength(1);
    await pool.query('UPDATE website_roles SET revoked_at=now() WHERE github_id=$1',[curator]);
    await expect(service.add(curator,{...base,evidenceUrls:['https://github.com/other/repo/pull/1']})).rejects.toMatchObject({code:'TAGGER_REQUIRED'});
  });
});

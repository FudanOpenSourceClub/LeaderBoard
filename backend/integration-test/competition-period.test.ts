import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {getDbPool} from '../src/db/index.js';
import {AnalyticsService} from '../src/analytics/index.js';
import {saveContributorActivity} from '../src/public-contributions/enrollment.js';
import type {PublicContribution} from '../src/public-contributions/export.js';
const pool=getDbPool(),clock=()=>new Date('2026-12-20T00:00:00.000Z'),service=new AnalyticsService(pool,clock);
let contributorId:string;
beforeAll(async()=>{
  await pool.query('TRUNCATE contributors,scoring_repositories,repository_star_counts,project_proposals RESTART IDENTITY CASCADE');
  const activity=(identifier:string,occurredAt:string,mergedAt:string|null=null):PublicContribution=>({kind:mergedAt?'pull_request':'issue',repository:'org/competition',repositoryGithubId:'101',identifier,occurredAt,mergedAt,title:'有效贡献',url:'https://github.com/org/competition/issues/'+identifier});
  const rows=[activity('1','2026-08-31T15:59:59.999Z'),activity('2','2026-08-31T16:00:00.000Z'),activity('3','2026-12-15T15:59:59.999Z'),activity('4','2026-12-15T16:00:00.000Z'),activity('5','2026-12-17T00:00:00.000Z'),activity('11','2026-08-01T00:00:00.000Z','2026-09-10T00:00:00.000Z'),activity('12','2026-09-15T00:00:00.000Z','2026-12-16T00:00:00.000Z')];
  await saveContributorActivity({githubId:'996001',login:'competitor',avatarUrl:null},{rows,totals:{commit:0,issue:5,pull_request:2},truncated:false,incomplete:false},pool);
  contributorId=(await pool.query('SELECT id::text FROM contributors WHERE github_id=996001')).rows[0].id;
  await pool.query("INSERT INTO scoring_repositories(github_id,full_name,html_url,enabled) VALUES(101,'org/competition','https://github.com/org/competition',TRUE)");
  await pool.query('INSERT INTO repository_star_counts(github_id,stars) VALUES(101,100)');
});
afterAll(async()=>{await pool.end()});
describe('competition scores across the full analytics pipeline',()=>{
  it('agrees between leaderboard and detail, keeps historical points separate, and ignores future events',async()=>{
    expect(await service.getContributorDetail('competitor','competition')).toMatchObject({range:'competition',score:60,commitIssueScore:10,prOpenedScore:20,prMergedScore:30,issues:2,prs:1});
    expect((await service.getContributorLeaderboard({range:'competition',metric:'score',limit:10}))[0]).toMatchObject({login:'competitor',score:60});
    expect(await service.getContributorDetail('competitor','all')).toMatchObject({score:125});
    const during=new AnalyticsService(pool,()=>new Date('2026-11-01T00:00:00.000Z'));
    expect(await during.getContributorDetail('competitor','competition')).toMatchObject({score:55,issues:1,prMergedScore:30});
    const before=new AnalyticsService(pool,()=>new Date('2026-07-01T00:00:00.000Z'));
    expect(await before.getContributorDetail('competitor','competition')).toMatchObject({score:0,total:0});
  });
  it('applies the same window to approved badges, project rewards and adjustments',async()=>{
    for(const [index,at] of ['2026-08-20T00:00:00.000Z','2026-12-01T00:00:00.000Z','2026-12-16T00:00:00.000Z'].entries()){
      await pool.query(`INSERT INTO contribution_tags(contributor_id,category,repository,evidence_urls,reason,actor_github_id,actor_login,created_at)
        VALUES($1,'contributor',$2,'[]','真实有效的比赛贡献奖励',996002,'reviewer',$3)`,[contributorId,'org/period-'+index,at]);
      const proposal=(await pool.query("INSERT INTO project_proposals(project_url,lab_name,notes,status) VALUES($1,'复旦实验室','真实项目申请','approved') RETURNING id",['https://github.com/org/project-'+index])).rows[0].id;
      await pool.query('INSERT INTO project_submission_awards(proposal_id,repository_github_id,contributor_id,awarded_at) VALUES($1,$2,$3,$4)',[proposal,200+index,contributorId,at]);
      await pool.query("INSERT INTO contributor_score_adjustments(contributor_id,delta,reason,actor_github_id,actor_login,request_id,created_at) VALUES($1,7,'真实贡献奖励分调整',996002,'reviewer',$2,$3)",[contributorId,randomUUID(),at]);
    }
    expect(await service.getContributorDetail('competitor','competition')).toMatchObject({score:102,outstandingScore:15,projectSubmissionScore:20,adjustmentScore:7});
    expect((await service.getContributorLeaderboard({range:'competition',metric:'score',limit:10}))[0]).toMatchObject({score:102,outstandingScore:15,projectSubmissionScore:20,adjustmentScore:7});
    expect(await service.getContributorDetail('competitor','all')).toMatchObject({score:236,outstandingScore:30,projectSubmissionScore:60,adjustmentScore:21});
    const later=new AnalyticsService(pool,()=>new Date('2027-02-01T00:00:00.000Z'));
    expect(await later.getContributorDetail('competitor','competition')).toMatchObject({score:102});
  });
});

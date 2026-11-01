import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {getDbPool} from "../src/db/index.js";
import {AnalyticsService} from "../src/analytics/index.js";
import {getContributorActivityExport,saveContributorActivity} from "../src/public-contributions/enrollment.js";
import {refreshRepositoryStars} from "../src/public-contributions/repository-stars.js";
import type {PublicContribution} from "../src/public-contributions/export.js";

const pool=getDbPool();
const now=new Date("2026-10-22T12:00:00Z");
beforeAll(async()=>{
  await pool.query("TRUNCATE commits,pull_requests,issues,contributors,repositories,groups,scoring_repositories,repository_star_counts RESTART IDENTITY CASCADE");
});
afterAll(async()=>{await pool.end()});
describe("Star-independent Commit/Issue scoring with an independent PR whitelist",()=>{
  it("keeps profile, ranking and ledger scores unchanged when Star snapshots change",async()=>{
    const row=(id:string,n:number,kind:PublicContribution['kind']):PublicContribution=>({
      kind,repository:id==='102'?'alice/my-project':`community/project-${id}`,repositoryGithubId:id,identifier:String(n),
      occurredAt:`2026-10-01T${String(n).padStart(2,'0')}:00:00Z`,
      mergedAt:kind==='pull_request'?'2026-10-20T00:00:00Z':null,title:'Contribution',url:`https://github.com/community/project-${id}/${kind}/${n}`,
    });
    const rows=[...Array.from({length:4},(_,i)=>row('101',i,'commit')),
      ...Array.from({length:4},(_,i)=>row('102',i,i%2?'issue':'commit')),
      row('103',1,'issue'),row('101',10,'pull_request'),row('103',11,'pull_request')];
    await saveContributorActivity({githubId:'7001',login:'alice',avatarUrl:null},{rows,totals:{commit:6,issue:3,pull_request:2},truncated:false,incomplete:false},pool);
    await pool.query("INSERT INTO scoring_repositories(github_id,full_name,html_url,enabled) VALUES (101,'community/project-101','https://github.com/community/project-101',TRUE)");
    const analytics=new AnalyticsService(pool,()=>now);
    expect((await analytics.getContributorDetail('alice','all'))?.score).toBe(57);
    const starCounts:Record<string,number>={'101':9,'102':10,'103':100};
    const fetcher=vi.fn(async(url:URL|RequestInfo)=>{
      const id=String(url).split('/').at(-1)!;
      return new Response(JSON.stringify({id:Number(id),private:false,stargazers_count:starCounts[id]}));
    }) as typeof fetch;
    expect(await refreshRepositoryStars('fixture',pool,fetcher)).toEqual({refreshed:3});
    const detail=await analytics.getContributorDetail('alice','all');
    expect(detail).toMatchObject({score:57,commitIssueScore:7,prOpenedScore:20,prMergedScore:30});
    expect(detail?.repositories.find(r=>r.githubId==='102')?.score).toBe(3);
    expect(detail?.repositories.find(r=>r.githubId==='103')?.score).toBe(1);
    expect((await analytics.getContributorLeaderboard({range:'all',metric:'score',limit:10}))[0]?.score).toBe(57);
    const ledger=await getContributorActivityExport('alice',pool);
    expect(ledger?.rows.reduce((sum,r)=>sum+(r.scoring?.points??0),0)).toBe(57);
    expect(ledger?.rows.filter(r=>r.repositoryGithubId==='101'&&r.kind==='commit').reduce((n,r)=>n+(r.scoring?.points??0),0)).toBe(3);
    await refreshRepositoryStars('fixture',pool,fetcher);expect(fetcher).toHaveBeenCalledTimes(3);
    // Recheck old repositories even when no contributor has added any new events.
    await pool.query("UPDATE repository_star_counts SET checked_at=now()-interval '2 days'");
    starCounts['102']=9;
    expect(await refreshRepositoryStars('fixture',pool,fetcher)).toEqual({refreshed:3});
    expect((await analytics.getContributorDetail('alice','all'))).toMatchObject({score:57,commitIssueScore:7,prOpenedScore:20,prMergedScore:30});
    expect((await analytics.getContributorLeaderboard({range:'all',metric:'score',limit:10}))[0]?.score).toBe(57);
  });
});

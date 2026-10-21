import { describe, expect, it } from "vitest";
import { scoreEvents, type ScoringEvent } from "../src/analytics/scoring.js";

const to="2026-11-02T00:00:00.000Z";
function event(n:number, repository="101", kind:ScoringEvent["kind"]="commit", contributorId="1"):ScoringEvent {
  return {contributorId,repositoryGithubId:repository,repository:`org/repo-${repository}`,kind,
    identifier:String(n),occurredAt:`2026-10-${String(Math.floor(n/24)+1).padStart(2,"0")}T${String(n%24).padStart(2,"0")}:00:00.000Z`,
    mergedAt:null,title:"Change",url:`https://github.com/org/repo-${repository}/${kind}/${n}`,group:"systems"};
}
const allowed=new Set(["101","102","103","104","105"]);
const points=(events:ScoringEvent[],from:string|null=null)=>scoreEvents(events,allowed,from,to);

describe("Contributor scoring rules",()=>{
  it("shares the repository quota between Commit and Issue",()=>{
    const data=points([event(1),event(2,"101","issue"),event(3),event(4,"101","issue")]);
    expect(data.users.get("1")?.score).toBe(3);
    expect(data.decisions[3]).toMatchObject({repositoryMonthCount:4,repositoryCapExceeded:true,points:0});
  });
  it("caps the combined monthly total at ten across repositories",()=>{
    const rows=Array.from({length:15},(_,i)=>event(i+1,String(101+Math.floor(i/3)),i%2?"issue":"commit"));
    const data=points(rows);
    expect(data.users.get("1")?.commitIssueScore).toBe(10);
    expect(data.decisions.filter(d=>d.monthlyCapExceeded)).toHaveLength(5);
    expect(data.decisions.every(d=>!d.repositoryCapExceeded)).toBe(true);
  });
  it("does not spend monthly quota on repository overflow",()=>{
    const rows=[...Array.from({length:12},(_,i)=>event(i)),...Array.from({length:9},(_,i)=>event(i+12,String(102+Math.floor(i/3))))];
    expect(points(rows).users.get("1")?.score).toBe(10);
  });
  it("keeps quotas per user and uses Shanghai natural-month boundaries",()=>{
    const sept=[1,2,3].map(i=>({...event(i),occurredAt:`2026-09-30T15:59:0${i}.000Z`}));
    const oct=[4,5,6].map(i=>({...event(i),occurredAt:`2026-09-30T16:00:0${i}.000Z`}));
    expect(points([...sept,...oct]).users.get("1")?.score).toBe(6);
    const other=[1,2,3].map(i=>event(i,"101","issue","2"));
    expect(points([...oct,...other]).users.get("2")?.score).toBe(3);
  });
  it("applies quotas before a view's time filter",()=>{
    const rows=[event(1),event(2),event(3),{...event(4),occurredAt:"2026-10-20T00:00:00.000Z"}];
    expect(points(rows,"2026-10-15T00:00:00.000Z").users.get("1")?.score).toBe(0);
  });
  it("awards PR submission and merge separately at their event times",()=>{
    const pr={...event(1,"101","pull_request"),occurredAt:"2026-09-15T00:00:00.000Z",mergedAt:"2026-10-20T00:00:00.000Z"};
    expect(points([pr]).users.get("1")).toMatchObject({score:50,prOpenedScore:20,prMergedScore:30,mergedPrs:1});
    expect(points([pr],"2026-10-01T00:00:00.000Z").users.get("1")?.score).toBe(30);
    expect(points([{...pr,mergedAt:null}]).users.get("1")?.score).toBe(20);
  });
  it("does not cap PR points and never double-awards a repeated or renamed event",()=>{
    const rows=Array.from({length:12},(_,i)=>({...event(i,"101","pull_request"),mergedAt:"2026-10-20T00:00:00.000Z"}));
    expect(points([...rows,...rows,{...rows[0]!,repository:"renamed/repository"}]).users.get("1")?.score).toBe(600);
  });
  it("requires stable whitelist IDs, not an identical repository name",()=>{
    const spoof={...event(1,"999","pull_request"),repository:"org/repo-101",mergedAt:"2026-10-20T00:00:00.000Z"};
    const missing={...event(2),repositoryGithubId:null};
    expect(points([spoof,missing]).users.get("1")?.score).toBe(0);
    expect(points([spoof,missing]).decisions.every(d=>!d.whitelisted)).toBe(true);
  });
});

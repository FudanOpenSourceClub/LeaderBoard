import {describe,expect,it,vi} from "vitest";
import type {Pool} from "pg";
import {refreshEnrolledContributors} from "../src/public-contributions/enrollment.js";
function fixture(accounts:Array<{login:string;github_id:string}>){
  let first=true;const saved:Array<unknown[]>=[];
  const client={query:vi.fn(async(sql:string,values:unknown[])=>{if(sql.includes("INSERT INTO contributors")){saved.push(values);return {rows:[{id:"77"}]}}return {rows:[]}}),release:vi.fn()};
  const pool={query:vi.fn(async()=>{if(first){first=false;return {rows:accounts}}return {rows:[]}}),connect:vi.fn(async()=>client)} as unknown as Pool;
  return {pool,saved};
}
const empty=()=>new Response(JSON.stringify({total_count:0,incomplete_results:false,items:[]}),{status:200});
describe("stable enrolled account identity",()=>{
  it("resolves by immutable ID after a username change and stores the current login",async()=>{
    const {pool,saved}=fixture([{login:"old-name",github_id:"111"}]);
    const fetcher=vi.fn(async(url:URL|RequestInfo)=>String(url).includes('/user/')?new Response(JSON.stringify({id:111,login:"new-name",avatar_url:null,type:"User"})):empty()) as typeof fetch;
    await refreshEnrolledContributors("fixture",pool,fetcher);
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe("https://api.github.com/user/111");
    expect(saved[0]?.slice(0,2)).toEqual(["111","new-name"]);
  });
  it("rejects a different returned ID without enrolling it",async()=>{
    const {pool,saved}=fixture([{login:"reused-name",github_id:"111"}]);
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:999,login:"reused-name",avatar_url:null,type:"User"}))) as typeof fetch;
    await expect(refreshEnrolledContributors("fixture",pool,fetcher)).rejects.toThrow("1 enrolled");expect(saved).toEqual([]);
  });
  it("continues healthy accounts after an individual lookup failure and reports a partial failure",async()=>{
    const {pool,saved}=fixture([{login:"missing",github_id:"111"},{login:"healthy",github_id:"222"}]);
    const fetcher=vi.fn(async(url:URL|RequestInfo)=>String(url).endsWith('/user/111')?new Response('{}',{status:404}):String(url).endsWith('/user/222')?new Response(JSON.stringify({id:222,login:"healthy",avatar_url:null,type:"User"})):empty()) as typeof fetch;
    await expect(refreshEnrolledContributors("fixture",pool,fetcher)).rejects.toThrow("1 enrolled");expect(saved[0]?.[0]).toBe("222");
  });
});

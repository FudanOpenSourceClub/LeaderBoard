import {describe,expect,it,vi} from "vitest";
import type {Pool} from "pg";
import {refreshRepositoryStars} from "../src/public-contributions/repository-stars.js";

function fixture(ids:string[]){
  const saved=new Map<string,number|null>();
  const query=vi.fn(async(sql:string,values:unknown[])=>{
    if(sql.includes("WITH active_repositories"))return {rows:ids.map(github_id=>({github_id}))};
    saved.set(String(values[0]),values[1] as number|null);return {rows:[]};
  });
  return {pool:{query} as unknown as Pool,saved};
}
function response(id:number,stars:number,privateRepo=false){return new Response(JSON.stringify({id,stargazers_count:stars,private:privateRepo}))}

describe("repository Star synchronization",()=>{
  it("queries immutable repository IDs and persists verified Star counts",async()=>{
    const {pool,saved}=fixture(["101","102"]);
    const fetcher=vi.fn(async(url:URL|RequestInfo)=>String(url).endsWith('/101')?response(101,9):response(102,10)) as typeof fetch;
    expect(await refreshRepositoryStars("fixture",pool,fetcher)).toEqual({refreshed:2});
    expect(saved).toEqual(new Map([["101",9],["102",10]]));
    expect(vi.mocked(fetcher).mock.calls.map(([url])=>String(url)).sort()).toEqual(["https://api.github.com/repositories/101","https://api.github.com/repositories/102"]);
  });
  it("removes eligibility for deleted or private repositories",async()=>{
    const {pool,saved}=fixture(["101","102"]);
    const fetcher=vi.fn(async(url:URL|RequestInfo)=>String(url).endsWith('/101')?new Response('{}',{status:404}):response(102,100,true)) as typeof fetch;
    await refreshRepositoryStars("fixture",pool,fetcher);
    expect(saved).toEqual(new Map([["101",null],["102",null]]));
  });
  it.each([
    {id:999,stargazers_count:100,private:false},
    {id:101,stargazers_count:-1,private:false},
    {id:101,private:false},
  ])("rejects invalid metadata without replacing a verified snapshot: %j",async metadata=>{
    const {pool,saved}=fixture(["101"]);
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(metadata))) as typeof fetch;
    await expect(refreshRepositoryStars("fixture",pool,fetcher)).rejects.toThrow("incomplete");
    expect(saved.size).toBe(0);
  });
  it("retries transient GitHub errors and preserves missing results on persistent failures",async()=>{
    const {pool,saved}=fixture(["101"]);
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockImplementation(async()=>response(101,10)) as typeof fetch;
    await refreshRepositoryStars("fixture",pool,fetcher);expect(saved.get("101")).toBe(10);
    const failed=fixture(["102"]);
    await expect(refreshRepositoryStars("fixture",failed.pool,vi.fn(async()=>new Response('{}',{status:503})) as typeof fetch)).rejects.toThrow("incomplete");
    expect(failed.saved.size).toBe(0);
  });
  it("reuses current cached metadata without making GitHub requests",async()=>{
    const {pool}=fixture([]);const fetcher=vi.fn() as typeof fetch;
    expect(await refreshRepositoryStars("fixture",pool,fetcher)).toEqual({refreshed:0});
    expect(fetcher).not.toHaveBeenCalled();
  });
});

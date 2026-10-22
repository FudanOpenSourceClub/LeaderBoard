import {describe,expect,it,vi} from "vitest";
import request from "supertest";
import {createApp} from "../src/app.js";
import {createApiRouter} from "../src/api/router.js";
import type {WebsiteUser} from "../src/auth/website-session.js";
const user:WebsiteUser={githubId:"123",login:"student",memberId:"42",isAdmin:false,csrfToken:"fixture-csrf"};
function setup(identity:WebsiteUser|null=user){
  const submit=vi.fn().mockResolvedValue({submitted:true,id:7});const review=vi.fn();const list=vi.fn().mockResolvedValue([]);
  const app=createApp({apiRouter:createApiRouter({analytics:{getGroups:vi.fn(),getOrganizationActivitySummary:vi.fn(),getRepositoryStats:vi.fn(),getContributorLeaderboard:vi.fn(),getContributorDetail:vi.fn()},
    websiteAuth:{getSession:async()=>identity,fromRegistration:async()=>null,getRegistrationIdentity:async()=>null,startLogin:vi.fn(),completeLogin:vi.fn()},projectProposals:{submit},projectReview:{list,review,projects:vi.fn().mockResolvedValue([])},notifyProjects:vi.fn().mockResolvedValue(undefined)})});
  return {app,submit,review,list};
}
const proposal={projectUrl:"https://github.com/FudanLab/example",labName:"复旦大学示例实验室",notes:"这是一个由实验室长期维护的开源项目，实验室主页也有项目介绍。"};
describe("registered project applications and admin review",()=>{
  it("rejects anonymous and incompletely registered applicants before storing anything",async()=>{
    for(const identity of [null,{...user,memberId:null,isAdmin:true}]){const {app,submit}=setup(identity);await request(app).post("/api/v1/project-proposals").send(proposal).expect(401);expect(submit).not.toHaveBeenCalled()}
  });
  it("requires a session CSRF token and binds the verified member on the server",async()=>{
    const {app,submit}=setup();await request(app).post("/api/v1/project-proposals").send(proposal).expect(403);
    await request(app).post("/api/v1/project-proposals").set("X-CSRF-Token",user.csrfToken).send({...proposal,memberId:"spoofed"}).expect(201,{submitted:true,id:7});
    expect(submit).toHaveBeenCalledWith(proposal,"42");
  });
  it("rejects malformed repositories and non-GitHub destinations",async()=>{
    const {app,submit}=setup();await request(app).post("/api/v1/project-proposals").set("X-CSRF-Token",user.csrfToken).send({...proposal,projectUrl:"https://example.com/repo"}).expect(400);expect(submit).not.toHaveBeenCalled();
  });
  it("protects both admin read and write endpoints",async()=>{
    const {app,review,list}=setup();await request(app).get("/api/v1/admin/project-proposals").expect(403);
    await request(app).post("/api/v1/admin/project-proposals/7/review").set("X-CSRF-Token",user.csrfToken).send({decision:"reject",isAdmin:true}).expect(403);
    expect(review).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
  });
  it("allows only the server-confirmed admin to review, with CSRF protection",async()=>{
    const {app,review}=setup({...user,isAdmin:true});await request(app).get("/api/v1/admin/project-proposals").expect(200,{items:[]});
    await request(app).post("/api/v1/admin/project-proposals/7/review").send({decision:"reject"}).expect(403);
    await request(app).post("/api/v1/admin/project-proposals/7/review").set("X-CSRF-Token",user.csrfToken).send({decision:"approve",description:"这是公开展示的项目简介，供其他用户了解项目。"}).expect(200,{reviewed:true});
    expect(review).toHaveBeenCalledWith(7,expect.objectContaining({decision:"approve"}),"123");
  });
});

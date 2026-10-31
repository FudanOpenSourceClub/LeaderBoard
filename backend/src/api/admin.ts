import { Router, type Request } from "express";
import {
  AdminRolesResponseSchema,AdminRoleRequestSchema,AdminAuditResponseSchema,AdminContributorsResponseSchema,
  ScoreAdjustmentRequestSchema,ScoreAdjustmentSchema,ScoreAdjustmentsResponseSchema,ReverseAdjustmentRequestSchema,
} from "@leadboard/contracts";
import type { WebsiteUser } from "../auth/website-session.js";
import { AdminError,listWebsiteRoles,setWebsiteRole,listAdminAudit } from "../auth/roles.js";
import { ScoreAdjustmentService } from "../analytics/adjustments.js";

export async function resolveGitHubLogin(login:string) {
  const response=await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`,{
    headers:{Accept:"application/vnd.github+json",...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})},signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw new AdminError("GITHUB_LOOKUP_FAILED",response.status===404?404:503,response.status===404?"GitHub 用户不存在":"GitHub 暂时不可用，请稍后重试");
  const body=await response.json() as {id?:unknown;login?:unknown;type?:unknown};
  if(body.type!=="User"||typeof body.id!=="number"||!Number.isSafeInteger(body.id)||body.id<=0||typeof body.login!=="string")throw new AdminError("INVALID_GITHUB_USER",400,"只能向真实 GitHub 用户授权");
  return {githubId:String(body.id),login:body.login};
}
export interface WebsiteAdminDependencies {
  roles:typeof listWebsiteRoles;setRole:typeof setWebsiteRole;audit:typeof listAdminAudit;resolve:typeof resolveGitHubLogin;
  scores:Pick<ScoreAdjustmentService,"list"|"contributors"|"adjust"|"reverse">;
}
export function createWebsiteAdminRouter(authorize:(req:Request)=>Promise<WebsiteUser>,deps:Partial<WebsiteAdminDependencies>={}) {
  const router=Router();
  const roles=deps.roles??listWebsiteRoles,setRole=deps.setRole??setWebsiteRole,audit=deps.audit??listAdminAudit,resolve=deps.resolve??resolveGitHubLogin;
  const scores=deps.scores??new ScoreAdjustmentService();
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next()});
  const owner=async(req:Request)=>{const user=await authorize(req);if(user.role!=="owner")throw new AdminError("OWNER_REQUIRED",403,"仅站长可以管理授权");return user};
  router.get("/roles",async(req,res,next)=>{try{await owner(req);res.json(AdminRolesResponseSchema.parse({items:await roles()}))}catch(e){next(e)}});
  router.post("/roles",async(req,res,next)=>{try{
    const user=await owner(req);const parsed=AdminRoleRequestSchema.safeParse(req.body);
    if(!parsed.success)throw new AdminError("INVALID_ROLE_REQUEST",400,"请填写 GitHub 用户名、角色和至少5字的授权原因");
    await setRole(user.githubId,await resolve(parsed.data.githubLogin),parsed.data.role,parsed.data.reason);
    res.json(AdminRolesResponseSchema.parse({items:await roles()}));
  }catch(e){next(e)}});
  router.get("/contributors",async(req,res,next)=>{try{
    await authorize(req);const query=typeof req.query.query==="string"?req.query.query.trim():"";
    if(!query||query.length>39)throw new AdminError("INVALID_QUERY",400,"请输入 GitHub 用户名");
    res.json(AdminContributorsResponseSchema.parse({items:await scores.contributors(query)}));
  }catch(e){next(e)}});
  router.get("/score-adjustments",async(req,res,next)=>{try{
    await authorize(req);const githubId=req.query.githubId;
    if(githubId!==undefined&&(typeof githubId!=="string"||!/^[1-9]\d{0,17}$/.test(githubId)))throw new AdminError("INVALID_ID",400,"用户 ID 无效");
    res.json(ScoreAdjustmentsResponseSchema.parse({items:await scores.list(githubId as string|undefined)}));
  }catch(e){next(e)}});
  router.post("/score-adjustments",async(req,res,next)=>{try{
    const user=await authorize(req);const parsed=ScoreAdjustmentRequestSchema.safeParse(req.body);
    if(!parsed.success)throw new AdminError("INVALID_ADJUSTMENT",400,"请选择贡献者、填写非零整数分值和至少5字的原因");
    res.status(201).json(ScoreAdjustmentSchema.parse(await scores.adjust(user.githubId,parsed.data)));
  }catch(e){next(e)}});
  router.post("/score-adjustments/:id/reverse",async(req,res,next)=>{try{
    const user=await authorize(req);const id=req.params.id;const parsed=ReverseAdjustmentRequestSchema.safeParse(req.body);
    if(typeof id!=="string"||!/^[1-9]\d{0,17}$/.test(id)||!parsed.success)throw new AdminError("INVALID_REVERSAL",400,"请填写至少5字的撤销原因");
    res.status(201).json(ScoreAdjustmentSchema.parse(await scores.reverse(user.githubId,id,parsed.data.reason,parsed.data.requestId)));
  }catch(e){next(e)}});
  router.get("/audit",async(req,res,next)=>{try{await authorize(req);res.json(AdminAuditResponseSchema.parse({items:await audit()}))}catch(e){next(e)}});
  return router;
}

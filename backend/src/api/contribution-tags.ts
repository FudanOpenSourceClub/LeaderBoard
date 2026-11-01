import {Router,type Request} from "express";
import {z} from "zod";
import {AddContributionTagRequestSchema,ContributionTagSchema,ContributionTagsResponseSchema,AdminContributorsResponseSchema} from "@leadboard/contracts";
import type {WebsiteUser} from "../auth/website-session.js";
import {ContributionTagService} from "../analytics/contribution-tags.js";
import {AdminError} from "../auth/roles.js";
export type ContributionTagApi=Pick<ContributionTagService,'add'|'revoke'|'search'|'list'>;
export function createContributionTagRouter(authorize:(req:Request)=>Promise<WebsiteUser>,service:ContributionTagApi=new ContributionTagService()){
  const router=Router();router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
  router.get('/tag-contributors',async(req,res,next)=>{try{await authorize(req);const q=typeof req.query.query==='string'?req.query.query.trim():'';if(!q||q.length>39)throw new AdminError('INVALID_QUERY',400,'请输入 GitHub 用户名');res.json(AdminContributorsResponseSchema.parse({items:await service.search(q)}))}catch(e){next(e)}});
  router.get('/contribution-tags',async(req,res,next)=>{try{await authorize(req);res.json(ContributionTagsResponseSchema.parse({items:await service.list()}))}catch(e){next(e)}});
  router.post('/contribution-tags',async(req,res,next)=>{try{const actor=await authorize(req),input=AddContributionTagRequestSchema.safeParse(req.body);if(!input.success)throw new AdminError('INVALID_TAG',400,input.error.issues[0]?.message??'请核对标签资料');res.status(201).json(ContributionTagSchema.parse(await service.add(actor.githubId,input.data)))}catch(e){next(e)}});
  router.post('/contribution-tags/:id/revoke',async(req,res,next)=>{try{const actor=await authorize(req);if(actor.role!=='owner')throw new AdminError('OWNER_REQUIRED',403,'仅站长可以撤销标签');const input=z.object({reason:z.string().trim().min(5).max(1000)}).strict().safeParse(req.body);const id=req.params.id;if(typeof id!=='string'||!/^\d+$/.test(id)||!input.success)throw new AdminError('INVALID_TAG',400,'请填写至少5字的撤销原因');res.json(ContributionTagSchema.parse(await service.revoke(actor.githubId,id,input.data.reason)))}catch(e){next(e)}});return router;
}

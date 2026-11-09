import { Router, type Request } from 'express';
import { OutstandingApplicationRequestSchema, OutstandingApplicationReviewSchema, OutstandingApplicationSchema, OutstandingApplicationsResponseSchema } from '@leadboard/contracts';
import type { WebsiteUser } from '../auth/website-session.js';
import { OutstandingApplicationService } from '../analytics/outstanding-applications.js';
import { AdminError } from '../auth/roles.js';

export type OutstandingApplicationApi=Pick<OutstandingApplicationService,'apply'|'list'|'review'>;
export function createOutstandingApplicationRouter(authorize:(req:Request,reviewer?:boolean)=>Promise<WebsiteUser>,service:OutstandingApplicationApi=new OutstandingApplicationService()) {
  const router=Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
  router.get('/outstanding-applications',async(req,res,next)=>{
    try{const user=await authorize(req);res.json(OutstandingApplicationsResponseSchema.parse({items:await service.list(user.githubId)}))}catch(error){next(error)}
  });
  router.post('/outstanding-applications',async(req,res,next)=>{
    try{
      const user=await authorize(req),input=OutstandingApplicationRequestSchema.safeParse(req.body);
      if(!input.success)throw new AdminError('INVALID_APPLICATION',400,input.error.issues[0]?.message??'请核对勋章申请资料');
      res.status(201).json(OutstandingApplicationSchema.parse(await service.apply(user.githubId,input.data)));
    }catch(error){next(error)}
  });
  router.get('/admin/outstanding-applications',async(req,res,next)=>{
    try{await authorize(req,true);res.json(OutstandingApplicationsResponseSchema.parse({items:await service.list()}))}catch(error){next(error)}
  });
  router.post('/admin/outstanding-applications/:id/review',async(req,res,next)=>{
    try{
      const user=await authorize(req,true),id=req.params.id,input=OutstandingApplicationReviewSchema.safeParse(req.body);
      if(typeof id!=='string'||!/^\d+$/.test(id)||!input.success)throw new AdminError('INVALID_REVIEW',400,'请核对审核结论，驳回需填写至少5字原因');
      res.json(OutstandingApplicationSchema.parse(await service.review(user.githubId,id,input.data)));
    }catch(error){next(error)}
  });
  return router;
}

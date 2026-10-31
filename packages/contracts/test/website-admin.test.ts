import {describe,expect,it} from 'vitest';
import {AdminRoleRequestSchema,ScoreAdjustmentRequestSchema,WebsiteSessionSchema,ContributorRankSchema} from '../src/index.js';
const requestId='12345678-1234-4234-8234-123456789abc';
describe('website administration contracts',()=>{
 it('accepts signed score changes but rejects spoofed privileged fields',()=>{
   expect(ScoreAdjustmentRequestSchema.safeParse({githubId:'123',delta:-10,reason:'重复计分调整记录',requestId}).success).toBe(true);
   for(const delta of [0,0.1,-100001,100001])expect(ScoreAdjustmentRequestSchema.safeParse({githubId:'123',delta,reason:'重复计分调整记录',requestId}).success).toBe(false);
   expect(AdminRoleRequestSchema.safeParse({githubLogin:'reviewer',role:'admin',reason:'新增审核人员授权',githubId:'123'}).success).toBe(false);
 });
 it('returns the database role and supports a negative overall score',()=>{
   expect(WebsiteSessionSchema.parse({authenticated:true,login:'reviewer',registered:false,isAdmin:true,role:'admin',csrfToken:'csrf'})).toHaveProperty('role','admin');
   expect(ContributorRankSchema.parse({rank:1,login:'student',avatarUrl:null,commits:0,prs:0,issues:0,total:0,score:-3,adjustmentScore:-3})).toHaveProperty('score',-3);
 });
});

import {useEffect,useState} from "react";
import {Link} from "react-router";
import {ApiErrorResponseSchema,ProjectProposalAdminResponseSchema,type ProjectProposalAdmin} from "@leadboard/contracts";
import {useWebsiteSession} from "../auth/session";
import { Button, Card, Textarea } from "../components/ui/primitives";

function ReviewCard({item,csrfToken,onReviewed}:{item:ProjectProposalAdmin;csrfToken:string;onReviewed:()=>void}){
  const [description,setDescription]=useState("");const [reviewNotes,setReviewNotes]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function review(decision:"approve"|"reject"){
    if(decision==="approve"&&description.trim().length<10){setError("通过前请填写至少10字的公开简介。");return}
    setBusy(true);setError("");
    try{const response=await fetch(`/api/v1/admin/project-proposals/${item.id}/review`,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({decision,reviewNotes,...(decision==="approve"?{description}: {})})});
      const payload=await response.json();if(!response.ok){const parsed=ApiErrorResponseSchema.safeParse(payload);throw new Error(parsed.success?parsed.data.error.message:"审核失败")}
      onReviewed();
    }catch(e){setError(e instanceof Error?e.message:"审核失败")}finally{setBusy(false)}
  }
  return <Card className="panel" style={{padding:24,marginBottom:18}}>
    <div className="panel-heading"><div><p>申请 #{item.id} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p><h2>{item.labName}</h2></div><span className="tag">{{pending:"待审核",approved:"已通过",rejected:"已拒绝"}[item.status]}</span></div>
    <p>申请人 GitHub：{item.submitterLogin??"历史申请"}</p>
    <p><a href={item.projectUrl} target="_blank" rel="noreferrer">{item.projectUrl} ↗</a></p>
    <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.notes}</p>
    <p className="filter-caption">邮件通知：{item.notificationSent?"已发送":`尚未确认发送（${item.notificationAttempts} 次尝试）`}</p>
    {item.status==="pending"?<>
      <label className="form-field"><span>公开简介（通过后展示在项目列表）</span><Textarea value={description} onChange={e=>setDescription(e.target.value)} minLength={10} maxLength={500} placeholder="填写项目用途和特点；申请中的原始说明不会自动公开。" /></label>
      <label className="form-field"><span>审核备注</span><Textarea value={reviewNotes} onChange={e=>setReviewNotes(e.target.value)} maxLength={1000} /></label>
      <div className="profile-actions"><Button className="primary-button" type="button" disabled={busy} onClick={()=>void review("approve")}>通过并加入项目列表</Button><Button className="toolbar-button" variant="outline" type="button" disabled={busy} onClick={()=>void review("reject")}>拒绝申请</Button></div>
    </>:<p>审核备注：{item.reviewNotes||"无"} · {item.reviewedAt?new Date(item.reviewedAt).toLocaleString("zh-CN"):""}</p>}
    {error&&<p role="alert" className="verify-notice verify-notice-error">{error}</p>}
  </Card>;
}
export function ProjectReviewPage(){
  const {session,loading}=useWebsiteSession();const [items,setItems]=useState<ProjectProposalAdmin[]>([]);const [error,setError]=useState("");const [version,setVersion]=useState(0);
  useEffect(()=>{if(!session.authenticated||!session.isAdmin)return;let active=true;
    void fetch("/api/v1/admin/project-proposals",{cache:"no-store"}).then(async r=>{const p=await r.json();if(!r.ok)throw new Error("无法读取申请，请重新登录管理员账号");return ProjectProposalAdminResponseSchema.parse(p)})
      .then(p=>{if(active){setItems(p.items);setError("")}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false};},[session,version]);
  return <div className="page-canvas"><section className="page-hero compact-hero"><div><span className="hero-badge">ADMINISTRATION</span><h1>仓库申请审核</h1><p>查看申请内容，决定是否加入复旦开源项目列表。</p></div></section>
    {loading?<p role="status">正在确认管理权限…</p>:!session.authenticated?<section className="panel" style={{padding:24}}><h2>请使用管理员 GitHub 账号登录</h2><a className="primary-button" href="/api/v1/auth/github/login?returnTo=/admin">使用 GitHub 登录后台</a></section>:!session.isAdmin?<p role="alert">当前账号没有管理权限。</p>:<section className="dashboard-content">
      <p>当前管理员：{session.login} · {items.length} 条申请 · <Link to="/projects">查看项目列表</Link></p>
      <Button className="toolbar-button" variant="outline" onClick={()=>setVersion(v=>v+1)} type="button">刷新申请</Button>
      {error&&<p role="alert">{error}</p>}{!error&&items.length===0&&<p>暂无申请。</p>}
      {items.map(item=><ReviewCard key={item.id+item.status} item={item} csrfToken={session.csrfToken} onReviewed={()=>setVersion(v=>v+1)}/>)}
    </section>}
  </div>;
}

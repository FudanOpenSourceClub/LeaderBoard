import {useEffect,useState,type FormEvent} from "react";
import {z} from "zod";
import {
  AdminRolesResponseSchema,AdminContributorsResponseSchema,AdminAuditResponseSchema,
  ScoreAdjustmentsResponseSchema,ScoreAdjustmentSchema,ApiErrorResponseSchema,
  type AdminRoleEntry,type ScoreAdjustment,
} from "@leadboard/contracts";
import {Button,Card,Input,Textarea} from "../components/ui/primitives";

async function call<T>(path:string,schema:z.ZodType<T>,csrfToken?:string,body?:unknown):Promise<T> {
  const response=await fetch(`/api/v1/admin/${path}`,{cache:"no-store",...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken??""},body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok){const error=ApiErrorResponseSchema.safeParse(data);throw new Error(error.success?error.data.error.message:"操作失败，请刷新后重试")}
  return schema.parse(data);
}
const time=(v:string)=>new Date(v).toLocaleString("zh-CN");
export function WebsiteAdminPanels({csrfToken,isOwner}:{csrfToken:string;isOwner:boolean}) {
  const [tab,setTab]=useState<"scores"|"roles"|"audit">("scores");
  return <Card className="panel admin-panel">
    <h2>网站管理</h2>
    <div className="admin-tabs" role="group" aria-label="管理功能">
      <Button variant={tab==="scores"?"default":"outline"} onClick={()=>setTab("scores")}>积分调整</Button>
      {isOwner&&<Button variant={tab==="roles"?"default":"outline"} onClick={()=>setTab("roles")}>管理员授权</Button>}
      <Button variant={tab==="audit"?"default":"outline"} onClick={()=>setTab("audit")}>操作记录</Button>
    </div>
    {tab==="scores"?<Scores csrfToken={csrfToken}/>:tab==="roles"&&isOwner?<Roles csrfToken={csrfToken}/>:<Audit/>}
  </Card>;
}
function Scores({csrfToken}:{csrfToken:string}) {
  const [query,setQuery]=useState("");const [matches,setMatches]=useState<{githubId:string;login:string}[]>([]);
  const [target,setTarget]=useState<{githubId:string;login:string}|null>(null);
  const [delta,setDelta]=useState("");const [reason,setReason]=useState("");const [reverseReason,setReverseReason]=useState("");
  const [items,setItems]=useState<ScoreAdjustment[]>([]);const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [version,setVersion]=useState(0);
  // The key stays stable on an uncertain retry; editing any field starts a new operation.
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [reverseRequest,setReverseRequest]=useState<{id:string;reason:string;key:string}|null>(null);
  useEffect(()=>{let active=true;void call("score-adjustments",ScoreAdjustmentsResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError(String(e.message))});return()=>{active=false}},[version]);
  async function search(e:FormEvent){e.preventDefault();setError("");setBusy(true);setMatches([]);setTarget(null);try{const r=await call(`contributors?query=${encodeURIComponent(query.trim())}`,AdminContributorsResponseSchema);setMatches(r.items);if(r.items.length===0)setMessage("没有找到贡献者，请核对 GitHub 用户名。")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function adjust(e:FormEvent){e.preventDefault();if(!target)return;setBusy(true);setError("");setMessage("");try{
    const result=await call("score-adjustments",ScoreAdjustmentSchema,csrfToken,{githubId:target.githubId,delta:Number(delta),reason:reason.trim(),requestId});
    setMessage(`已为 ${result.login} 调整 ${result.delta>0?"+":""}${result.delta} 分，记录 #${result.id}。`);setDelta("");setReason("");setRequestId(crypto.randomUUID());setVersion(v=>v+1);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function reverse(item:ScoreAdjustment){setBusy(true);setError("");setMessage("");const operation=reverseRequest?.id===item.id&&reverseRequest.reason===reverseReason.trim()?reverseRequest:{id:item.id,reason:reverseReason.trim(),key:crypto.randomUUID()};setReverseRequest(operation);try{
    await call(`score-adjustments/${item.id}/reverse`,ScoreAdjustmentSchema,csrfToken,{reason:operation.reason,requestId:operation.key});setMessage(`已撤销记录 #${item.id}，原记录和撤销记录均已保留。`);setReverseRequest(null);setVersion(v=>v+1);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section aria-label="积分调整">
    <p className="filter-caption">填写加减分值：例如 10 为加 10 分，-10 为扣 10 分。每次操作必须填写原因。</p>
    <form className="admin-form" onSubmit={e=>void search(e)}><label className="form-field"><span>查找贡献者</span><Input required maxLength={39} value={query} onChange={e=>{setQuery(e.target.value);setTarget(null);setMatches([]);setRequestId(crypto.randomUUID())}} placeholder="GitHub 用户名" /></label><Button variant="outline" type="submit" disabled={busy}>查找</Button></form>
    <div className="admin-matches">{matches.map(m=><Button key={m.githubId} variant={target?.githubId===m.githubId?"default":"outline"} disabled={busy} onClick={()=>{setTarget(m);setRequestId(crypto.randomUUID())}}>{m.login}</Button>)}</div>
    {target&&<form className="admin-form" onSubmit={e=>void adjust(e)}>
      <p>调整对象：<strong>{target.login}</strong></p>
      <label className="form-field"><span>加减分值</span><Input type="number" required min={-100000} max={100000} step={1} value={delta} onChange={e=>{setDelta(e.target.value);setRequestId(crypto.randomUUID())}} /></label>
      <label className="form-field"><span>调整原因（至少 5 字）</span><Textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setRequestId(crypto.randomUUID())}} /></label>
      <Button type="submit" disabled={busy||Number(delta)===0||!Number.isInteger(Number(delta))||reason.trim().length<5}>确认调整 {Number(delta)>0?"+":""}{delta} 分</Button>
    </form>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    <h3>最近调分记录</h3><p className="filter-caption">最近 200 条；撤销会新增一笔相反分值，原始记录保留。</p>
    <label className="form-field"><span>撤销原因（撤销记录时必填）</span><Input value={reverseReason} onChange={e=>setReverseReason(e.target.value)} minLength={5} maxLength={1000}/></label>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>对象</th><th>分值</th><th>原因</th><th>操作人 / 时间</th><th>操作</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.login}</td><td>{i.delta>0?"+":""}{i.delta}</td><td>{i.reason}{i.reversesId&&`（撤销 #${i.reversesId}）`}</td><td>{i.actorLogin}<br/>{time(i.createdAt)}</td><td>{i.reversed?"已撤销":i.reversesId?"撤销记录":<Button variant="outline" disabled={busy||reverseReason.trim().length<5} onClick={()=>void reverse(i)}>撤销 #{i.id}</Button>}</td></tr>)}</tbody></table>{items.length===0&&<p>暂无调分记录。</p>}</div>
  </section>;
}
function Roles({csrfToken}:{csrfToken:string}) {
  const [items,setItems]=useState<AdminRoleEntry[]>([]);const [login,setLogin]=useState("");const [role,setRole]=useState<"admin"|"owner"|"revoke">("admin");const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  useEffect(()=>{let active=true;void call("roles",AdminRolesResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{const r=await call("roles",AdminRolesResponseSchema,csrfToken,{githubLogin:login.trim(),role:role==="revoke"?null:role,reason:reason.trim()});setItems(r.items);setMessage(`已更新 ${login} 的网站权限。`);setReason("")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section aria-label="管理员授权"><p className="filter-caption">管理员可审核项目、调整积分；站长还可管理授权。撤权后下次请求立即检查新权限。</p>
    <form className="admin-form" onSubmit={e=>void save(e)}>
      <label className="form-field"><span>GitHub 用户名</span><Input required maxLength={39} value={login} onChange={e=>setLogin(e.target.value)} /></label>
      <label className="form-field"><span>网站角色</span><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="admin">管理员（审核、调分）</option><option value="owner">站长（含授权管理）</option><option value="revoke">撤销管理权限</option></select></label>
      <label className="form-field"><span>操作原因（至少 5 字）</span><Textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <Button type="submit" disabled={busy||reason.trim().length<5}>确认{role==="revoke"?"撤销权限":"授权"}</Button>
    </form>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>授权时间 / 原因</th></tr></thead><tbody>{items.map(i=><tr key={i.githubId}><td>{i.login}</td><td>{i.role==="owner"?"站长":"管理员"}</td><td>{i.revokedAt?"已撤销":"生效中"}</td><td>{time(i.grantedAt)}<br/>{i.reason}</td></tr>)}</tbody></table></div>
  </section>;
}
function Audit(){const [items,setItems]=useState<z.infer<typeof AdminAuditResponseSchema>["items"]>([]);const [error,setError]=useState("");useEffect(()=>{let active=true;void call("audit",AdminAuditResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[]);return <section aria-label="操作记录"><h3>最近操作记录</h3>{error&&<p role="alert">{error}</p>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>操作人</th><th>对象</th><th>操作</th><th>原因</th><th>时间</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.actorLogin}</td><td>{i.targetLogin}</td><td>{({"role.set":"授权","role.revoke":"撤权","role.bootstrap":"初始化站长","score.adjust":"调整积分","score.reverse":"撤销调分"} as Record<string,string>)[i.action]??i.action}</td><td>{i.reason}</td><td>{time(i.createdAt)}</td></tr>)}</tbody></table>{!items.length&&!error&&<p>暂无操作记录。</p>}</div></section>}

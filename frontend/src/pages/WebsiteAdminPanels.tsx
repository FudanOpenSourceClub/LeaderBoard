import { History, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useLanguage } from "../state/language";
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
  if(!response.ok){const error=ApiErrorResponseSchema.safeParse(data);throw new Error(error.success?error.data.error.message:"Action failed. Refresh to try again.")}
  return schema.parse(data);
}
export function WebsiteAdminPanels({csrfToken,isOwner}:{csrfToken:string;isOwner:boolean}) {
  const { t } = useLanguage();
  const [tab,setTab]=useState<"scores"|"roles"|"audit">("scores");
  return <Card className="admin-queue admin-site-panel">
    <header className="admin-queue-heading"><h2>{t("网站管理", "Site administration")}</h2></header>
    <div className="admin-tabs" role="group" aria-label={t("管理功能", "Admin tools")}>
      <Button variant="ghost" aria-pressed={tab === "scores"} onClick={()=>setTab("scores")}><SlidersHorizontal size={15} aria-hidden="true" />{t("积分调整", "Point adjustments")}</Button>
      {isOwner&&<Button variant="ghost" aria-pressed={tab === "roles"} onClick={()=>setTab("roles")}><ShieldCheck size={15} aria-hidden="true" />{t("管理员授权", "Admin access")}</Button>}
      <Button variant="ghost" aria-pressed={tab === "audit"} onClick={()=>setTab("audit")}><History size={15} aria-hidden="true" />{t("操作记录", "Audit log")}</Button>
    </div>
    {tab==="scores"?<Scores csrfToken={csrfToken}/>:tab==="roles"&&isOwner?<Roles csrfToken={csrfToken}/>:<Audit/>}
  </Card>;
}
function Scores({csrfToken}:{csrfToken:string}) {
  const { locale, t } = useLanguage();
  const [query,setQuery]=useState("");const [matches,setMatches]=useState<{githubId:string;login:string}[]>([]);
  const [target,setTarget]=useState<{githubId:string;login:string}|null>(null);
  const [delta,setDelta]=useState("");const [reason,setReason]=useState("");const [reverseReason,setReverseReason]=useState("");
  const [items,setItems]=useState<ScoreAdjustment[]>([]);const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [version,setVersion]=useState(0);
  // The key stays stable on an uncertain retry; editing any field starts a new operation.
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [reverseRequest,setReverseRequest]=useState<{id:string;reason:string;key:string}|null>(null);
  useEffect(()=>{let active=true;void call("score-adjustments",ScoreAdjustmentsResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError(String(e.message))});return()=>{active=false}},[version]);
  async function search(e:FormEvent){e.preventDefault();setError("");setBusy(true);setMatches([]);setTarget(null);try{const r=await call(`contributors?query=${encodeURIComponent(query.trim())}`,AdminContributorsResponseSchema);setMatches(r.items);if(r.items.length===0)setMessage(t("没有找到贡献者，请核对 GitHub 用户名。", "No contributors found. Check the GitHub username."))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function adjust(e:FormEvent){e.preventDefault();if(!target)return;setBusy(true);setError("");setMessage("");try{
    const result=await call("score-adjustments",ScoreAdjustmentSchema,csrfToken,{githubId:target.githubId,delta:Number(delta),reason:reason.trim(),requestId});
    setMessage(t(`已为 ${result.login} 调整 ${result.delta>0?"+":""}${result.delta} 分，记录 #${result.id}。`, `Adjusted ${result.login} by ${result.delta>0?"+":""}${result.delta} points (entry #${result.id}).`));setDelta("");setReason("");setRequestId(crypto.randomUUID());setVersion(v=>v+1);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function reverse(item:ScoreAdjustment){setBusy(true);setError("");setMessage("");const operation=reverseRequest?.id===item.id&&reverseRequest.reason===reverseReason.trim()?reverseRequest:{id:item.id,reason:reverseReason.trim(),key:crypto.randomUUID()};setReverseRequest(operation);try{
    await call(`score-adjustments/${item.id}/reverse`,ScoreAdjustmentSchema,csrfToken,{reason:operation.reason,requestId:operation.key});setMessage(t(`已撤销记录 #${item.id}，原记录和撤销记录均已保留。`, `Reversed entry #${item.id}. Both entries are retained.`));setReverseRequest(null);setVersion(v=>v+1);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section aria-label={t("积分调整", "Point adjustments")}>
    <p className="filter-caption">{t("填写加减分值：例如 10 为加 10 分，-10 为扣 10 分。每次操作必须填写原因。", "Enter a positive or negative adjustment, such as 10 or -10. A reason is required.")}</p>
    <form className="admin-form" onSubmit={e=>void search(e)}><label className="form-field"><span>{t("查找贡献者", "Find a contributor")}</span><Input required maxLength={39} value={query} onChange={e=>{setQuery(e.target.value);setTarget(null);setMatches([]);setRequestId(crypto.randomUUID())}} placeholder={t("GitHub 用户名", "GitHub username")} /></label><Button variant="outline" type="submit" disabled={busy}><Search size={15} aria-hidden="true" />{t("查找", "Search")}</Button></form>
    <div className="admin-matches">{matches.map(m=><Button key={m.githubId} variant={target?.githubId===m.githubId?"default":"outline"} disabled={busy} onClick={()=>{setTarget(m);setRequestId(crypto.randomUUID())}}>{m.login}</Button>)}</div>
    {target&&<form className="admin-form" onSubmit={e=>void adjust(e)}>
      <p>{t("调整对象：", "Contributor: ")}<strong>{target.login}</strong></p>
      <label className="form-field"><span>{t("加减分值", "Point change")}</span><Input type="number" required min={-100000} max={100000} step={1} value={delta} onChange={e=>{setDelta(e.target.value);setRequestId(crypto.randomUUID())}} /></label>
      <label className="form-field"><span>{t("调整原因（至少 5 字）", "Reason (at least 5 characters)")}</span><Textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setRequestId(crypto.randomUUID())}} /></label>
      <Button type="submit" disabled={busy||Number(delta)===0||!Number.isInteger(Number(delta))||reason.trim().length<5}>{t("确认调整", "Confirm adjustment: ")}{Number(delta)>0?"+":""}{delta}{t("分", "pts")}</Button>
    </form>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    <h3>{t("最近调分记录", "Recent adjustments")}</h3><p className="filter-caption">{t("最近 200 条；撤销会新增一笔相反分值，原始记录保留。", "The last 200 entries. Reversals create an opposite adjustment and preserve the original entry.")}</p>
    <label className="form-field"><span>{t("撤销原因（撤销记录时必填）", "Reason (required to reverse an adjustment)")}</span><Input value={reverseReason} onChange={e=>setReverseReason(e.target.value)} minLength={5} maxLength={1000}/></label>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t("对象", "Target")}</th><th>{t("分值", "Points")}</th><th>{t("原因", "Reason")}</th><th>{t("操作人 / 时间", "Actor / time")}</th><th>{t("操作", "Action")}</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.login}</td><td>{i.delta>0?"+":""}{i.delta}</td><td>{i.reason}{i.reversesId&&t(`（撤销 #${i.reversesId}）`, ` (reverses #${i.reversesId})`)}</td><td>{i.actorLogin}<br/>{new Date(i.createdAt).toLocaleString(locale)}</td><td>{i.reversed?t("已撤销", "Reversed"):i.reversesId?t("撤销记录", "Reversal"):<Button variant="outline" disabled={busy||reverseReason.trim().length<5} onClick={()=>void reverse(i)}>{t("撤销 #", "Reverse #")}{i.id}</Button>}</td></tr>)}</tbody></table>{items.length===0&&<p>{t("暂无调分记录。", "No point adjustments yet.")}</p>}</div>
  </section>;
}
function Roles({csrfToken}:{csrfToken:string}) {
  const { locale, t } = useLanguage();
  const [items,setItems]=useState<AdminRoleEntry[]>([]);const [login,setLogin]=useState("");const [role,setRole]=useState<"admin"|"owner"|"revoke">("admin");const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
  useEffect(()=>{let active=true;void call("roles",AdminRolesResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{const r=await call("roles",AdminRolesResponseSchema,csrfToken,{githubLogin:login.trim(),role:role==="revoke"?null:role,reason:reason.trim()});setItems(r.items);setMessage(t(`已更新 ${login} 的网站权限。`, `Updated site access for ${login}.`));setReason("")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section aria-label={t("管理员授权", "Admin access")}><p className="filter-caption">{t("标注员仅能添加贡献分类标签；项目审核、调分、撤销标签及授权由站长处理。撤权后下次请求立即检查新权限。", "Badge reviewers can add contribution tags. The site owner handles project review, point adjustments, tag revocation, and access. Changes take effect on the next request.")}</p>
    <form className="admin-form" onSubmit={e=>void save(e)}>
      <label className="form-field"><span>{t("GitHub 用户名", "GitHub username")}</span><Input required maxLength={39} value={login} onChange={e=>setLogin(e.target.value)} /></label>
      <label className="form-field"><span>{t("网站角色", "Site role")}</span><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="admin">{t("标注员（仅添加分类标签）", "Badge reviewer (can add contribution tags)")}</option><option value="owner">{t("站长（含授权管理）", "Site owner (can manage access)")}</option><option value="revoke">{t("撤销管理权限", "Remove admin access")}</option></select></label>
      <label className="form-field"><span>{t("操作原因（至少 5 字）", "Reason (at least 5 characters)")}</span><Textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <Button type="submit" disabled={busy||reason.trim().length<5}>{t("确认", "Confirm ")}{role==="revoke"?t("撤销权限", "remove access"):t("授权", "Grant access")}</Button>
    </form>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t("账号", "Account")}</th><th>{t("角色", "Role")}</th><th>{t("状态", "Status")}</th><th>{t("授权时间 / 原因", "Granted at / reason")}</th></tr></thead><tbody>{items.map(i=><tr key={i.githubId}><td>{i.login}</td><td>{i.role==="owner"?t("站长", "Site owner"):t("标签标注员", "Badge reviewer")}</td><td>{i.revokedAt?t("已撤销", "Reversed"):t("生效中", "Active")}</td><td>{new Date(i.grantedAt).toLocaleString(locale)}<br/>{i.reason}</td></tr>)}</tbody></table></div>
  </section>;
}
function Audit(){
  const { locale, t } = useLanguage();const [items,setItems]=useState<z.infer<typeof AdminAuditResponseSchema>["items"]>([]);const [error,setError]=useState("");useEffect(()=>{let active=true;void call("audit",AdminAuditResponseSchema).then(r=>{if(active)setItems(r.items)}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false}},[]);return <section aria-label={t("操作记录", "Audit log")}><h3>{t("最近操作记录", "Recent activity")}</h3>{error&&<p role="alert">{error}</p>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t("操作人", "Actor")}</th><th>{t("对象", "Target")}</th><th>{t("操作", "Action")}</th><th>{t("原因", "Reason")}</th><th>{t("时间", "Time")}</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.actorLogin}</td><td>{i.targetLogin}</td><td>{({"role.set":t("授权", "Grant access"),"role.revoke":t("撤权", "Removed access"),"role.bootstrap":t("初始化站长", "Initialized site owner"),"score.adjust":t("调整积分", "Adjusted points"),"score.reverse":t("撤销调分", "Reversed adjustment")} as Record<string,string>)[i.action]??i.action}</td><td>{i.reason}</td><td>{new Date(i.createdAt).toLocaleString(locale)}</td></tr>)}</tbody></table>{!items.length&&!error&&<p>{t("暂无操作记录。", "No audit entries yet.")}</p>}</div></section>}

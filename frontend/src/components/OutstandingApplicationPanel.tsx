import { useEffect, useState, type FormEvent } from 'react';
import { OUTSTANDING_LABELS, OutstandingApplicationRequestSchema, OutstandingApplicationsResponseSchema, type OutstandingApplication, type ContributionCategory } from '@leadboard/contracts';
import { Button, Card, Input, Textarea } from './ui/primitives';

export function OutstandingApplicationPanel({csrfToken}:{csrfToken:string}) {
  const [category,setCategory]=useState<ContributionCategory>('contributor');
  const [repository,setRepository]=useState(''),[reason,setReason]=useState(''),[urls,setUrls]=useState('');
  const [items,setItems]=useState<OutstandingApplication[]>([]),[version,setVersion]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;void fetch('/api/v1/outstanding-applications',{cache:'no-store'})
    .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error?.message??'无法读取申请');return OutstandingApplicationsResponseSchema.parse(data)})
    .then(data=>{if(active){setItems(data.items);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[version]);
  async function submit(event:FormEvent) {
    event.preventDefault();setError('');setMessage('');
    const input=OutstandingApplicationRequestSchema.safeParse({category,repository,reason,evidenceUrls:urls.split('\n').map(s=>s.trim()).filter(Boolean)});
    if(!input.success){setError(input.error.issues[0]?.message??'请核对申请资料');return}
    setBusy(true);
    try{
      const response=await fetch('/api/v1/outstanding-applications',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(input.data)});
      const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'申请提交失败');
      setMessage('申请已提交。审核通过后加入当月 Outstanding 榜，并获得15分奖励。');setReason('');setUrls('');setVersion(v=>v+1);
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Card className="panel outstanding-application-panel"><h2>申请 Outstanding 勋章</h2>
    <p className="filter-caption">仅能为本人申请。审核通过后加入当月荣誉榜；每枚勋章加15分，自审核通过起有效一个月。</p>
    <details><summary>填写申请</summary><form className="admin-form" onSubmit={event=>void submit(event)}>
      <label className="form-field">申请勋章<select value={category} disabled={busy} onChange={e=>setCategory(e.target.value as ContributionCategory)}>{Object.entries(OUTSTANDING_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <p className="filter-caption">{category==='contributor'?'提供被采用的贡献或被确认有效的问题反馈。':category==='committer'?'同一仓库近90天至少3个合并 PR，提交跨至少两周。':'提供公开维护者名单，以及近90天至少两次公开维护活动证据。'}</p>
      <label className="form-field">申请仓库<Input required maxLength={200} placeholder="owner/repository" value={repository} disabled={busy} onChange={e=>setRepository(e.target.value)}/></label>
      <label className="form-field">申请理由（审核通过后公开）<Textarea required minLength={5} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <label className="form-field">GitHub 贡献证据（每行一个，最多6个，同一仓库）<Textarea required value={urls} disabled={busy} placeholder="https://github.com/owner/repository/pull/123" onChange={e=>setUrls(e.target.value)}/></label>
      <Button type="submit" disabled={busy}>{busy?'正在提交…':'提交本人申请'}</Button>
    </form></details>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error} <Button variant="ghost" onClick={()=>setVersion(v=>v+1)}>刷新申请</Button></p>}
    <h3>我的申请</h3>{!items.length&&<p className="filter-caption">暂无申请记录。</p>}
    {items.map(item=><div className="outstanding-reason" key={item.id}><strong>{OUTSTANDING_LABELS[item.category]}</strong><p>{item.repository} · {{pending:'待审核',approved:'已通过',rejected:'已驳回'}[item.status]}</p>{item.reviewNote&&<p>审核意见：{item.reviewNote}</p>}</div>)}
  </Card>;
}

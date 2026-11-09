import {useEffect,useState} from 'react';
import {OUTSTANDING_LABELS,OutstandingApplicationsResponseSchema,ContributionTagsResponseSchema,type OutstandingApplication,type ContributionTag} from '@leadboard/contracts';
import {Button,Card,Input,Textarea} from '../components/ui/primitives';
import {useWebsiteSession} from '../auth/session';

async function call(path:string,csrf?:string,body?:unknown){
  const response=await fetch('/api/v1/admin/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'操作失败');return data;
}
export function ContributionTagPanel({csrfToken,isOwner}:{csrfToken:string;isOwner:boolean}){
  const {session}=useWebsiteSession();
  const [applications,setApplications]=useState<OutstandingApplication[]>([]),[tags,setTags]=useState<ContributionTag[]>([]);
  const [notes,setNotes]=useState<Record<string,string>>({}),[revokeReason,setRevokeReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[version,setVersion]=useState(0);
  useEffect(()=>{let active=true;void Promise.all([call('outstanding-applications'),call('contribution-tags')]).then(([a,t])=>{
    if(active){setApplications(OutstandingApplicationsResponseSchema.parse(a).items);setTags(ContributionTagsResponseSchema.parse(t).items);setError('')}
  }).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[version]);
  async function review(id:string,decision:'approved'|'rejected'){
    setBusy(true);setError('');setMessage('');try{
      await call('outstanding-applications/'+id+'/review',csrfToken,{decision,note:notes[id]??''});
      setMessage(decision==='approved'?'申请已通过，勋章已加入当月 Outstanding 榜，奖励15分。':'申请已驳回。');setVersion(v=>v+1);
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function revoke(id:string){setBusy(true);setError('');try{await call('contribution-tags/'+id+'/revoke',csrfToken,{reason:revokeReason.trim()});setVersion(v=>v+1);setMessage('勋章已撤销。')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Card className="panel admin-panel"><h2>Outstanding 勋章申请审核</h2>
    <p>由本人在开源达人榜点击自己的头像提交申请。核对仓库、理由和证据后审核；不能审核自己的申请。</p>
    <Button variant="outline" disabled={busy} onClick={()=>setVersion(v=>v+1)}>刷新申请</Button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!applications.length&&<p>暂无申请。</p>}
    {applications.map(item=><section className="outstanding-review-card" key={item.id}>
      <h3>{item.login} · {OUTSTANDING_LABELS[item.category]}</h3><p><a href={'https://github.com/'+item.repository} target="_blank" rel="noreferrer">{item.repository}</a> · {{pending:'待审核',approved:'已通过',rejected:'已驳回'}[item.status]}</p>
      <p className="outstanding-reason-text">{item.reason}</p><div className="tag-row">{item.evidenceUrls.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">证据 {i+1} ↗</a>)}</div>
      {item.status==='pending'&&(session.authenticated&&session.login.toLowerCase()===item.login.toLowerCase()?<p>请由其他管理员审核本人的申请。</p>:<>
        <label className="form-field">审核意见（驳回必填，至少5字）<Textarea maxLength={1000} value={notes[item.id]??''} disabled={busy} onChange={e=>setNotes(n=>({...n,[item.id]:e.target.value}))}/></label>
        <div className="tag-row"><Button disabled={busy} onClick={()=>void review(item.id,'approved')}>通过申请</Button><Button variant="outline" disabled={busy||(notes[item.id]??'').trim().length<5} onClick={()=>void review(item.id,'rejected')}>驳回申请</Button></div>
      </>)}{item.reviewNote&&<p>审核意见：{item.reviewNote}</p>}
    </section>)}
    <h3>当前有效勋章</h3>{isOwner&&<label className="form-field">撤销原因<Input minLength={5} maxLength={1000} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)}/></label>}
    {tags.map(tag=><div className="outstanding-reason" key={tag.id}><p>{tag.login} · {OUTSTANDING_LABELS[tag.category]} · {tag.repository}</p><p>{tag.reason}</p>{isOwner&&<Button variant="outline" disabled={busy||revokeReason.trim().length<5} onClick={()=>void revoke(tag.id)}>撤销勋章</Button>}</div>)}
  </Card>;
}

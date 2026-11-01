import {useEffect,useState,type FormEvent} from "react";
import {AddContributionTagRequestSchema,ContributionTagsResponseSchema,AdminContributorsResponseSchema,type ContributionTag} from "@leadboard/contracts";
import {Button,Card,Input,Textarea} from "../components/ui/primitives";
const labels={contributor:'Contributor｜有效贡献',committer:'Committer｜持续代码贡献',maintainer:'Maintainer｜维护与治理'};
const rules={contributor:'至少一项被采用的贡献，或被项目确认有效的问题反馈。',committer:'同一项目近90天至少3个合并 PR，提交跨至少两周，且包含实质功能、修复或改进。',maintainer:'公开维护者名单证明身份，近90天至少两次公开维护活动，如评审、处理 Issue、帮助新人。'};
async function call(path:string,csrf?:string,body?:unknown){const r=await fetch('/api/v1/admin/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf??''},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error?.message??'操作失败');return data}
export function ContributionTagPanel({csrfToken,isOwner}:{csrfToken:string;isOwner:boolean}){
  const [query,setQuery]=useState(''),[matches,setMatches]=useState<{githubId:string;login:string}[]>([]),[target,setTarget]=useState<{githubId:string;login:string}|null>(null);
  const [category,setCategory]=useState<keyof typeof labels>('contributor'),[urls,setUrls]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [items,setItems]=useState<ContributionTag[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[version,setVersion]=useState(0);
  const [revokeReason,setRevokeReason]=useState('');
  useEffect(()=>{let active=true;void call('contribution-tags').then(d=>{if(active)setItems(ContributionTagsResponseSchema.parse(d).items)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[version]);
  async function search(e:FormEvent){e.preventDefault();setBusy(true);setError('');setTarget(null);setMatches([]);try{const r=AdminContributorsResponseSchema.parse(await call('tag-contributors?query='+encodeURIComponent(query.trim())));setMatches(r.items);if(!r.items.length)setMessage('未找到贡献者，请核对用户名。')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function add(e:FormEvent){e.preventDefault();if(!target)return;setError('');setMessage('');const input=AddContributionTagRequestSchema.safeParse({githubId:target.githubId,category,evidenceUrls:urls.split('\n').map(s=>s.trim()).filter(Boolean),reason:reason.trim(),confirmed});if(!input.success){setError(input.error.issues[0]?.message??'请核对资料');return}setBusy(true);try{await call('contribution-tags',csrfToken,input.data);setMessage('标签已添加，已记录认定依据与操作人。');setUrls('');setReason('');setConfirmed(false);setVersion(v=>v+1)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function revoke(id:string){setBusy(true);setError('');try{await call('contribution-tags/'+id+'/revoke',csrfToken,{reason:revokeReason.trim()});setVersion(v=>v+1);setMessage('标签已撤销，原记录保留。')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Card className="panel admin-panel"><h2>贡献分类标注</h2><p>标签记录平台对公开贡献的分类，注明对应项目与依据。标签不加分，不授予 GitHub 权限。</p>
    <details><summary>审核规则</summary>{Object.entries(rules).map(([key,value])=><p key={key}><strong>{labels[key as keyof typeof labels]}：</strong>{value}</p>)}<p>重复、灌水、刷量不计；证据不足暂不添加。标注员不能给自己添加，撤销由站长处理。</p></details>
    <form className="admin-form" onSubmit={e=>void search(e)}><label className="form-field">查找贡献者<Input required maxLength={39} value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setTarget(null);setMatches([])}}/></label><Button type="submit" disabled={busy}>查找</Button></form>
    <div className="admin-matches">{matches.map(m=><Button key={m.githubId} disabled={busy} variant={target?.githubId===m.githubId?'default':'outline'} onClick={()=>{setTarget(m);setConfirmed(false)}}>{m.login}</Button>)}</div>
    {target&&<form className="admin-form" onSubmit={e=>void add(e)}><p>标注对象：<strong>{target.login}</strong> · <a href={'/contributors/'+encodeURIComponent(target.login)} target="_blank" rel="noreferrer">查看贡献数据 ↗</a></p>
      <label className="form-field">贡献分类<select disabled={busy} value={category} onChange={e=>{setCategory(e.target.value as keyof typeof labels);setConfirmed(false)}}>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><p>{rules[category]}</p>
      <label className="form-field">公开证据链接（每行一个，最多6个，须属于同一项目）<Textarea required value={urls} disabled={busy} onChange={e=>{setUrls(e.target.value);setConfirmed(false)}} placeholder="https://github.com/组织/项目/pull/123"/></label>
      <label className="form-field">认定依据（公开展示，至少5字）<Textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>我已核对公开证据、贡献者身份及上述分类条件，确认不是重复、灌水或刷量记录。</label>
      <Button type="submit" disabled={busy||!confirmed||reason.trim().length<5}>添加分类标签</Button></form>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    <h3>最近标注</h3>{isOwner&&<label className="form-field">撤销原因<Input minLength={5} maxLength={1000} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)}/></label>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>贡献者 / 项目</th><th>分类 / 依据</th><th>标注人</th>{isOwner&&<th>操作</th>}</tr></thead><tbody>{items.map(t=><tr key={t.id}><td>{t.login}<br/>{t.repository}</td><td>{labels[t.category]}<br/>{t.reason}<br/>{t.evidenceUrls.map((u,i)=><a key={u} href={u} target="_blank" rel="noreferrer">证据{i+1} ↗ </a>)}</td><td>{t.actorLogin}<br/>{new Date(t.createdAt).toLocaleString('zh-CN')}</td>{isOwner&&<td><Button variant="outline" disabled={busy||revokeReason.trim().length<5} onClick={()=>void revoke(t.id)}>撤销</Button></td>}</tr>)}</tbody></table>{!items.length&&<p>暂无标注。</p>}</div>
  </Card>;
}

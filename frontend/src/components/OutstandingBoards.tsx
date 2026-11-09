import {useEffect,useState} from "react";
import {Link} from "react-router";
import type {ContributionCategory,OutstandingBoardsResponse} from "@leadboard/contracts";
import type {LeadBoardApiClient} from "../api/client";

export function OutstandingBoards({api}:{api:LeadBoardApiClient}){
  const [data,setData]=useState<OutstandingBoardsResponse|null>(null);
  const [selected,setSelected]=useState<ContributionCategory|null>(null);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;
    const refresh=()=>void api.getOutstandingBoards().then(value=>{if(active){setData(value);setError('')}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'荣誉榜加载失败')});
    refresh();const timer=setInterval(refresh,60000);return()=>{active=false;clearInterval(timer)};
  },[api,retry]);
  const board=data?.boards.find(b=>b.category===selected);
  return <section className="outstanding-section" aria-label="本月 Outstanding 荣誉榜">
    <div className="section-title-row"><h2>本月荣誉榜</h2><span className="filter-caption">有效标签每个 +15 分 · 可累加</span></div>
    <div className="outstanding-grid">
      {(['contributor','committer','maintainer'] as const).map(category=>{
        const item=data?.boards.find(b=>b.category===category);
        return <button key={category} className={'outstanding-card'+(selected===category?' outstanding-card-selected':'')}
          type="button" aria-expanded={selected===category} aria-controls="outstanding-people"
          onClick={()=>setSelected(previous=>previous===category?null:category)}>
          <span>Outstanding</span><strong>{category[0]!.toUpperCase()+category.slice(1)}</strong>
          <small>{item?`${item.people.length} 位获奖者`:'加载中…'} <span aria-hidden="true">↗</span></small>
        </button>;
      })}
    </div>
    {error&&<p role="alert">{error} <button className="text-button" type="button" onClick={()=>setRetry(v=>v+1)}>重试</button></p>}
    {selected&&<div id="outstanding-people" className="panel outstanding-people" aria-live="polite">
      <div className="section-title-row"><h3>{board?.title??'正在加载…'}</h3><button className="text-button" type="button" onClick={()=>setSelected(null)}>收起</button></div>
      <p className="filter-caption">展示当前有效期内的获奖者；每个标签自发放日起有效一个月。由本人提交申请，管理员审核通过后展示。</p>
      {board?.people.length===0&&<p>本月暂无有效获奖者。</p>}
      {board?.people.map(person=><article className="outstanding-person" key={person.login}>
        <div className="section-title-row"><Link to={'/contributors/'+encodeURIComponent(person.login)}><strong>{person.login}</strong></Link><span className="tag">标签奖励 {person.score} 分</span></div>
        {person.tags.map(tag=><div className="outstanding-reason" key={tag.id}>
          <p><strong>{tag.repository}</strong> · +15 分</p><p className="outstanding-reason-text">{tag.reason}</p>
          <p className="filter-caption">审核人：{tag.actorLogin} · 有效至 {new Date(tag.expiresAt).toLocaleString('zh-CN')}</p>
          <div className="tag-row">{tag.evidenceUrls.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">公开证据 {i+1} ↗</a>)}</div>
        </div>)}
      </article>)}
    </div>}
  </section>;
}

import type {ContributorDetail,ContributionTag} from "@leadboard/contracts";
const labels={contributor:'Contributor｜有效贡献',committer:'Committer｜持续代码贡献',maintainer:'Maintainer｜维护与治理'};
export function ContributionBadges({tags}:{tags:ContributionTag[]}){return <>{tags.map(t=><span className="tag" key={t.id} title={'平台标注 · '+t.repository+' · '+t.reason}>{labels[t.category]} · {t.repository}</span>)}</>}
export function ContributionProfile({detail}:{detail:ContributorDetail}){
  const p=detail.contributionProfile,tags=detail.communityTags??[];
  return <><section className="panel admin-panel"><h2>平台贡献分类</h2><p>依据公开贡献人工标注，不代表项目方授予身份或仓库权限。</p>{tags.length?tags.map(t=><article key={t.id}><h3>{labels[t.category]} · {t.repository}</h3><p>{t.reason}</p><p>{t.actorLogin} · {new Date(t.createdAt).toLocaleDateString('zh-CN')}</p>{t.evidenceUrls.map((u,i)=><a key={u} href={u} target="_blank" rel="noreferrer">公开证据 {i+1} ↗ </a>)}</article>):<p>暂无分类标签。</p>}</section>
    {p&&<section className="panel admin-panel"><h2>贡献评价分项</h2><p>当前时间范围内已采集的数据；按北京时间统计自然日和周，未按白名单及月度计分上限裁剪。</p><dl className="contribution-metrics"><dt>参与积极性</dt><dd>提交 PR {p.submittedPrs} · 提交 Issue {p.submittedIssues}</dd><dt>贡献成效</dt><dd>期间合并 PR {p.mergedPrs}</dd><dt>代码交付成功率</dt><dd>{p.prMergeRate===null?'暂无可计算的 PR':p.prMergeRate+'%'}（期间提交的 PR 中，截至统计时已合并 {p.mergedSubmittedPrs} 个）</dd><dt>持续活跃</dt><dd>{p.activeDays} 个活跃日 · {p.activeWeeks} 个活跃周</dd><dt>参与广度</dt><dd>{p.repositories} 个仓库</dd></dl><p>尚未采集：有效 Issue 认定、评审质量、代码质量、维护治理与人才培养。缺项不按0分处理，暂不生成综合百分制评分。</p>{p.incomplete&&<p role="status">采集范围可能不完整，请结合公开记录核对。</p>}<p>最近个人数据同步：{p.lastSyncedAt?new Date(p.lastSyncedAt).toLocaleString('zh-CN'):'暂无同步时间'}</p></section>}
  </>;
}

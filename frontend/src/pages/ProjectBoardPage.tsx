import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiErrorResponseSchema,
  CampusProjectsResponseSchema,
  type CampusProject,
  ProjectProposalResponseSchema,
} from "@leadboard/contracts";
import { Link } from "react-router";
import { useWebsiteSession } from "../auth/session";
import { useLocalFavorites } from "../lib/favorites";
import { Badge, Button, Card, Input, Textarea } from "../components/ui/primitives";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export function ProjectBoardPage() {
  const {session,loading:sessionLoading}=useWebsiteSession();
  const [campusProjects,setProjects]=useState<CampusProject[]>([]);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [catalogError,setCatalogError]=useState("");
  const [registerNotice,setRegisterNotice]=useState(false);
  useEffect(()=>{let active=true;void fetch("/api/v1/projects",{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("项目列表加载失败，请刷新后重试");return CampusProjectsResponseSchema.parse(await r.json())})
    .then(p=>{if(active)setProjects(p.items)}).catch(e=>{if(active)setCatalogError(e.message)}).finally(()=>{if(active)setCatalogLoading(false)});return()=>{active=false};},[]);
  const [showForm, setShowForm] = useState(false);
  const [projectUrl, setProjectUrl] = useState("");
  const [labName, setLabName] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const favorites = useLocalFavorites("projects");

  const availableTags = useMemo(
    () => [...new Set(campusProjects.flatMap((project) => [...project.tags]))].sort(),
    [campusProjects],
  );

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return campusProjects.filter((project) => {
      const matchesQuery = !normalized || [
        project.name,
        project.repo,
        project.lab,
        project.description,
        ...project.tags,
      ].some((value) => value.toLowerCase().includes(normalized));
      const matchesTag = !tag || project.tags.some((item) => item === tag);
      const matchesFavorite = !favoritesOnly || favorites.isFavorite(project.repo);
      return matchesQuery && matchesTag && matchesFavorite;
    });
  }, [campusProjects, query, tag, favoritesOnly, favorites.items]);

  async function submitProposal(event: FormEvent) {
    event.preventDefault();
    if (submit.status === "submitting") return;
    if(!session.authenticated||!session.registered){setShowForm(false);setRegisterNotice(true);return;}
    setSubmit({ status: "submitting" });

    try {
      const response = await fetch("/api/v1/project-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token":session.csrfToken },
        body: JSON.stringify({ projectUrl, labName, notes }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if(response.status===401){setShowForm(false);setRegisterNotice(true);return;}
      if (!response.ok) {
        const parsed = ApiErrorResponseSchema.safeParse(payload);
        throw new Error(parsed.success ? parsed.data.error.message : "提交失败");
      }
      ProjectProposalResponseSchema.parse(payload);
      setSubmit({ status: "success" });
      setProjectUrl("");
      setLabName("");
      setNotes("");
    } catch (error) {
      setSubmit({
        status: "error",
        message: error instanceof Error ? error.message : "提交失败，过会儿再试试。",
      });
    }
  }

  return (
    <div className="page-canvas">
      <section className="page-hero campus-project-hero">
        <div>
          <span className="hero-badge">FUDAN · OPEN SOURCE</span>
          <h1>复旦开源项目</h1>
          <p>复旦开源仓库必吃榜</p>
        </div>
      </section>

      <section className="toolbar-card" aria-label="项目筛选">
        <label className="search-box" aria-label="搜索项目">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、实验室或技术方向"
          />
        </label>
        <select className="toolbar-select" value={tag} onChange={(event) => setTag(event.target.value)} aria-label="按标签筛选">
          <option value="">全部方向</option>
          {availableTags.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
        <button
          className="toolbar-button"
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          {favoritesOnly ? "★ 只看收藏" : "☆ 只看收藏"}
        </button>
      </section>

      <section className="dashboard-content">
        <div className="section-title-row">
          <div>
            <p className="section-kicker">FUDAN PROJECTS</p>
            <h2>复旦开源仓库必吃榜</h2>
          </div>
          <Badge className="count-pill">{campusProjects.length} 个已核验项目</Badge>
        </div>

        {catalogError&&<p role="alert" className="verify-notice verify-notice-error">{catalogError}</p>}
        <div className="project-search-summary">
          <span>当前显示 {visibleProjects.length} / {campusProjects.length} 个项目</span>
          {(query || tag || favoritesOnly) && (
            <button
              className="text-button"
              type="button"
              onClick={() => { setQuery(""); setTag(""); setFavoritesOnly(false); }}
            >
              清除筛选
            </button>
          )}
        </div>

        {catalogLoading ? <p role="status">正在加载项目…</p> : visibleProjects.length === 0 ? (
          <div className="empty-filter-state">没有匹配的项目。换个关键词，或者清除筛选再看看。</div>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((project) => (
              <Card className="project-card" key={project.repo}>
                <div className="project-card-head">
                  <div>
                    <span className="project-lab">{project.lab}</span>
                    <h2>{project.name}</h2>
                    <code>{project.repo}</code>
                  </div>
                  <div className="project-card-actions">
                    <button
                      className="favorite-button"
                      type="button"
                      aria-label={favorites.isFavorite(project.repo) ? `取消收藏 ${project.name}` : `收藏 ${project.name}`}
                      aria-pressed={favorites.isFavorite(project.repo)}
                      onClick={() => favorites.toggle(project.repo)}
                      title="收藏只保存在当前浏览器"
                    >
                      {favorites.isFavorite(project.repo) ? "★" : "☆"}
                    </button>
                    <span className="verified-chip">✓ 已核验</span>
                  </div>
                </div>
                <p>{project.description}</p>
                <div className="project-tags">
                  {project.tags.map((item) => <Badge className="tag" key={item}>{item}</Badge>)}
                </div>
                <div className="project-links">
                  <a href={project.url} target="_blank" rel="noreferrer">打开项目 ↗</a>
                  {project.labUrl&&<a href={project.labUrl} target="_blank" rel="noreferrer">查看实验室来源 ↗</a>}
                </div>
              </Card>
            ))}
          </div>
        )}

        <section className="project-invite-card">
          <div className="project-invite-copy">
            <span className="section-kicker">YOUR PROJECT?</span>
            <h2>漏掉你们实验室的宝藏仓库了？</h2>
            <p>丢给我们看看 👀。只要能说明这是复旦大学实验室在维护的开源项目，我们核实后就把它补进来。</p>
          </div>
          <Button className="button button-primary" type="button" disabled={sessionLoading} onClick={() => {
            if(!session.authenticated||!session.registered){setRegisterNotice(true);setShowForm(false);return;}
            setRegisterNotice(false);
            setShowForm((value) => !value);
            if (submit.status === "success") setSubmit({ status: "idle" });
          }}>
            {showForm ? "先收起来" : "加上我的项目"}
          </Button>
        </section>

        {registerNotice&&<section className="panel" style={{padding:24}} role="alert"><h2>请先注册 LeaderBoard</h2><p>完成复旦邮箱验证和 GitHub 绑定后，即可申请加入仓库。</p><div className="profile-actions"><Link className="primary-button" to="/join">去注册网站</Link><a className="profile-action-link" href="/api/v1/auth/github/login?returnTo=/projects">已注册？使用 GitHub 登录</a></div></section>}
        {showForm && (
          <section className="panel proposal-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">PROJECT PROPOSAL</p>
                <h2>发个加入提议</h2>
                <p>不用写申请书，告诉我们项目在哪、哪个实验室在做，再补两句背景就行。</p>
              </div>
            </div>

            {submit.status === "success" ? (
              <div className="proposal-success" role="status">
                <span>✓</span>
                <div>
                  <strong>收到啦。</strong>
                  <p>申请已进入审核队列，管理员将收到邮件通知；通过后会加入项目列表。</p>
                </div>
              </div>
            ) : (
              <form className="proposal-form" onSubmit={submitProposal}>
                <label className="form-field">
                  <span>项目地址</span>
                  <Input
                    type="url"
                    value={projectUrl}
                    onChange={(event) => setProjectUrl(event.target.value)}
                    placeholder="https://github.com/your-lab/your-project"
                    required
                  />
                  <small>请填写公开的 GitHub 仓库地址。</small>
                </label>

                <label className="form-field">
                  <span>实验室 / 团队</span>
                  <Input
                    type="text"
                    value={labName}
                    onChange={(event) => setLabName(event.target.value)}
                    placeholder="例如：复旦大学 ×× 实验室"
                    minLength={2}
                    maxLength={120}
                    required
                  />
                  <small>写大家平时认得出来的名字就行。</small>
                </label>

                <label className="form-field">
                  <span>再说两句</span>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="这个项目是做什么的？怎么能看出是实验室在维护？有实验室主页、论文页或其他佐证也可以一起放这里。"
                    minLength={10}
                    maxLength={1200}
                    required
                  />
                  <small>{notes.length}/1200 · 不用正式，信息够我们核验就行。</small>
                </label>

                <Button className="primary-button" type="submit" disabled={submit.status === "submitting"}>
                  {submit.status === "submitting" ? "正在递过去…" : "提交加入提议"}
                </Button>

                {submit.status === "error" && (
                  <p className="verify-notice verify-notice-error" role="status">{submit.message}</p>
                )}
              </form>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

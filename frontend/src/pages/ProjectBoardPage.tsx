import { useMemo, useState, type FormEvent } from "react";
import {
  ApiErrorResponseSchema,
  ProjectProposalResponseSchema,
} from "@leadboard/contracts";
import { useLocalFavorites } from "../lib/favorites";

const campusProjects = [
  {
    name: "fastNLP",
    repo: "FudanNLP/fastNLP",
    url: "https://github.com/FudanNLP/fastNLP",
    lab: "复旦大学自然语言处理实验室",
    labUrl: "https://nlp.fudan.edu.cn/28699/list.htm",
    description: "面向自然语言处理任务的模块化、可扩展框架，复旦 NLP 实验室官网将其列为开源项目。",
    tags: ["NLP", "Python", "开源框架"],
  },
  {
    name: "fastHan",
    repo: "FudanNLP/fastHan",
    url: "https://github.com/FudanNLP/fastHan",
    lab: "复旦大学自然语言处理实验室",
    labUrl: "https://nlp.fudan.edu.cn/28699/list.htm",
    description: "中文分词、词性标注、依存分析和命名实体识别工具，同样收录在实验室官方开源项目页面。",
    tags: ["中文 NLP", "Python", "工具"],
  },
  {
    name: "ClassEval",
    repo: "FudanSELab/ClassEval",
    url: "https://github.com/FudanSELab/ClassEval",
    lab: "复旦大学软件工程实验室",
    labUrl: "https://datascience.fudan.edu.cn/80/db/c13525a688347/page.htm",
    description: "面向类级代码生成的 benchmark。项目位于 FudanSELab 组织，复旦校方页面可核验软件工程实验室信息。",
    tags: ["Software Engineering", "Benchmark", "Python"],
  },
] as const;

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export function ProjectBoardPage() {
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
    [],
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
  }, [query, tag, favoritesOnly, favorites.items]);

  async function submitProposal(event: FormEvent) {
    event.preventDefault();
    if (submit.status === "submitting") return;
    setSubmit({ status: "submitting" });

    try {
      const response = await fetch("/api/v1/project-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ projectUrl, labName, notes }),
      });
      const payload: unknown = await response.json().catch(() => null);
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
          <h1>校内开源项目</h1>
          <p>先从能通过公开来源核验的实验室项目开始。这里不做排行榜，也不拿 Star 给项目排座次，只把值得被看见的校内开源项目认真收进来。</p>
        </div>
      </section>

      <section className="toolbar-card" aria-label="项目筛选">
        <label className="search-box" aria-label="搜索项目">
          <input
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
            <p className="section-kicker">CAMPUS PROJECTS</p>
            <h2>先放几个我们能核验的</h2>
            <p>项目顺序只是展示顺序，不代表排名。</p>
          </div>
          <span className="count-pill">{campusProjects.length} 个已核验项目</span>
        </div>

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

        {visibleProjects.length === 0 ? (
          <div className="empty-filter-state">没有匹配的项目。换个关键词，或者清除筛选再看看。</div>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((project) => (
              <article className="project-card" key={project.repo}>
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
                  {project.tags.map((item) => <span className="tag" key={item}>{item}</span>)}
                </div>
                <div className="project-links">
                  <a href={project.url} target="_blank" rel="noreferrer">打开项目 ↗</a>
                  <a href={project.labUrl} target="_blank" rel="noreferrer">查看实验室来源 ↗</a>
                </div>
              </article>
            ))}
          </div>
        )}

        <section className="project-invite-card">
          <div className="project-invite-copy">
            <span className="section-kicker">YOUR PROJECT?</span>
            <h2>漏掉你们实验室的宝藏仓库了？</h2>
            <p>丢给我们看看 👀。只要能说明这是复旦校内实验室在维护的开源项目，我们核实后就把它补进来。</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => {
            setShowForm((value) => !value);
            if (submit.status === "success") setSubmit({ status: "idle" });
          }}>
            {showForm ? "先收起来" : "加上我的项目"}
          </button>
        </section>

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
                  <p>我们先去逛一圈仓库、核一下实验室信息，确认后再把它放上来。</p>
                </div>
              </div>
            ) : (
              <form className="proposal-form" onSubmit={submitProposal}>
                <label className="form-field">
                  <span>项目地址</span>
                  <input
                    type="url"
                    value={projectUrl}
                    onChange={(event) => setProjectUrl(event.target.value)}
                    placeholder="https://github.com/your-lab/your-project"
                    required
                  />
                  <small>GitHub、Gitee 或项目主页都可以，能直接看到项目最好。</small>
                </label>

                <label className="form-field">
                  <span>实验室 / 团队</span>
                  <input
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
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="这个项目是做什么的？怎么能看出是实验室在维护？有实验室主页、论文页或其他佐证也可以一起放这里。"
                    minLength={10}
                    maxLength={1200}
                    required
                  />
                  <small>{notes.length}/1200 · 不用正式，信息够我们核验就行。</small>
                </label>

                <button className="primary-button" type="submit" disabled={submit.status === "submitting"}>
                  {submit.status === "submitting" ? "正在递过去…" : "提交加入提议"}
                </button>

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

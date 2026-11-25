import { useLanguage } from "../state/language";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiErrorResponseSchema,
  CampusProjectsResponseSchema,
  type CampusProject,
  ProjectProposalResponseSchema,
} from "@leadboard/contracts";
import { Link, useSearchParams } from "react-router";
import { Blocks, Braces, Gauge, GitBranch, Languages, Layers3, Tag, Wrench, type LucideIcon } from "lucide-react";
import { useWebsiteSession } from "../auth/session";
import { useLocalFavorites } from "../lib/favorites";
import { Button, Card, Input, Textarea } from "../components/ui/primitives";
import { AppIcon, ExternalLinkIcon } from "../components/AppIcon";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

type TopicIcon = { icon: LucideIcon; accent: "language" | "code" | "benchmark" | "engineering" | "neutral" };

const topicIcons = new Map<string, TopicIcon>([
  ["nlp", { icon: Languages, accent: "language" }],
  ["中文 nlp", { icon: Languages, accent: "language" }],
  ["python", { icon: Braces, accent: "code" }],
  ["benchmark", { icon: Gauge, accent: "benchmark" }],
  ["software engineering", { icon: GitBranch, accent: "engineering" }],
  ["开源框架", { icon: Blocks, accent: "engineering" }],
  ["工具", { icon: Wrench, accent: "neutral" }],
]);

function ProjectTopicIcon({ tag }: { tag: string }) {
  const { icon: Icon, accent } = topicIcons.get(tag.trim().toLowerCase()) ?? { icon: Tag, accent: "neutral" };
  return <Icon className="project-topic-icon" data-accent={accent} size={13} aria-hidden="true" />;
}

export function ProjectBoardPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const searchInput = useRef<HTMLInputElement>(null);
  const {session,loading:sessionLoading}=useWebsiteSession();
  const [campusProjects,setProjects]=useState<CampusProject[]>([]);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [catalogError,setCatalogError]=useState("");
  const [registerNotice,setRegisterNotice]=useState(false);
  useEffect(()=>{let active=true;void fetch("/api/v1/projects",{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error(t("项目列表加载失败，请刷新后重试", "Could not load projects. Refresh to try again."));return CampusProjectsResponseSchema.parse(await r.json())})
    .then(p=>{if(active)setProjects(p.items)}).catch(e=>{if(active)setCatalogError(e.message)}).finally(()=>{if(active)setCatalogLoading(false)});return()=>{active=false};},[]);
  const [showForm, setShowForm] = useState(false);
  const [projectUrl, setProjectUrl] = useState("");
  const [labName, setLabName] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [topicQuery, setTopicQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const favorites = useLocalFavorites("projects");

  useEffect(() => {
    if (searchParams.get("search") === "1") searchInput.current?.focus();
  }, [searchParams]);

  const availableTags = useMemo(
    () => [...new Set(campusProjects.flatMap((project) => [...project.tags]))].sort(),
    [campusProjects],
  );

  const normalizedTopicQuery = topicQuery.trim().toLowerCase();
  const matchingTags = availableTags.filter((item) => item.toLowerCase().includes(normalizedTopicQuery));

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

  function clearFilters() {
    setQuery("");
    setTag("");
    setTopicQuery("");
    setFavoritesOnly(false);
  }

  function toggleProposal() {
    if (!session.authenticated || !session.registered) {
      setRegisterNotice(true);
      setShowForm(false);
      return;
    }
    setRegisterNotice(false);
    setShowForm((value) => !value);
    if (submit.status === "success") setSubmit({ status: "idle" });
  }

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
        throw new Error(parsed.success ? parsed.data.error.message : t("提交失败", "Submission failed"));
      }
      ProjectProposalResponseSchema.parse(payload);
      setSubmit({ status: "success" });
      setProjectUrl("");
      setLabName("");
      setNotes("");
    } catch (error) {
      setSubmit({
        status: "error",
        message: error instanceof Error ? error.message : t("提交失败，过会儿再试试。", "Submission failed. Try again later."),
      });
    }
  }

  return (
    <div className="projects-board">
      <h1 className="projects-title">
        <AppIcon name="repo" size={21} />
        <span>{t("复旦开源必吃榜", "Fudan OSS Picks")}</span>
      </h1>

      <div className="projects-toolbar">
        <label className="projects-search">
          <AppIcon name="search" size={18} />
          <Input
            ref={searchInput}
            type="search"
            aria-label={t("搜索项目", "Search projects")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索项目、仓库或实验室", "Search projects, repos, or labs")}
          />
        </label>
        <div className="projects-toolbar-actions">
          <Button variant="outline" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}>
            <AppIcon name="star" size={16} />
            {t("只看收藏", "Favorites")}
          </Button>
          <Button className="projects-suggest" disabled={sessionLoading} aria-expanded={showForm} onClick={toggleProposal}>
            <AppIcon name="plus" size={16} />
            {showForm ? t("收起表单", "Hide form") : t("加上我的项目", "Suggest my project")}
          </Button>
        </div>
      </div>

      <aside className="project-topics" aria-labelledby="project-topics-title">
        <h2 id="project-topics-title">{t("方向筛选", "Topics")}</h2>
        <label className="projects-search project-topics-search">
          <AppIcon name="search" size={16} />
          <Input
            type="search"
            aria-label={t("搜索方向标签", "Search topics")}
            value={topicQuery}
            onChange={(event) => setTopicQuery(event.target.value)}
            placeholder={t("搜索方向标签", "Search topics")}
          />
        </label>
        <div className="project-topic-list">
          <button type="button" className="project-topic" aria-pressed={!tag} onClick={() => setTag("")}>
            <Layers3 size={13} aria-hidden="true" />
            <span>{t("全部方向", "All topics")}</span>
          </button>
          {matchingTags.map((item) => (
            <button type="button" className="project-topic" aria-pressed={tag === item} key={item} onClick={() => setTag(item)}>
              <ProjectTopicIcon tag={item} />
              <span>{item}</span>
            </button>
          ))}
        </div>
        {normalizedTopicQuery && matchingTags.length === 0 && (
          <p className="project-topic-empty" role="status">{t("没有匹配的方向标签。", "No matching topics.")}</p>
        )}
      </aside>

      <section className="project-results" aria-label={t("项目列表", "Project results")}>
        {registerNotice && (
          <section className="panel project-register-notice" role="alert">
            <h2>{t("请先注册 LeaderBoard", "Join LeaderBoard first")}</h2>
            <div className="profile-actions">
              <Link className="primary-button" to="/join">{t("去注册网站", "Join LeaderBoard")}</Link>
              <a className="profile-action-link" href="/api/v1/auth/github/login?returnTo=/projects">
                <AppIcon name="github" size={16} />
                {t("已注册？使用 GitHub 登录", "Already registered? Sign in with GitHub")}
              </a>
            </div>
          </section>
        )}

        {showForm && (
          <section className="panel proposal-panel">
            <div className="panel-heading">
              <div>
                <h2>{t("提交项目", "Suggest a project")}</h2><p className="filter-caption">{t("审核通过后，提交者获得 20 分奖励；同一仓库只奖励一次。", "Approved suggestions earn 20 points, once per repository.")}</p>
              </div>
            </div>

            {submit.status === "success" ? (
              <div className="proposal-success" role="status">
                <span>✓</span>
                <div>
                  <strong>{t("收到啦。", "Suggestion received.")}</strong>
                  <p>{t("等待审核", "Awaiting review")}</p>
                </div>
              </div>
            ) : (
              <form className="proposal-form" onSubmit={submitProposal}>
                <label className="form-field">
                  <span>{t("项目地址", "Repository URL")}</span>
                  <Input
                    type="url"
                    value={projectUrl}
                    onChange={(event) => setProjectUrl(event.target.value)}
                    placeholder="https://github.com/your-lab/your-project"
                    required
                  />
                   
                </label>

                <label className="form-field">
                  <span>{t("实验室 / 团队", "Lab or team")}</span>
                  <Input
                    type="text"
                    value={labName}
                    onChange={(event) => setLabName(event.target.value)}
                    placeholder={t("例如：复旦大学 ×× 实验室", "Example: Fudan University Research Lab")}
                    minLength={2}
                    maxLength={120}
                    required
                  />
                   
                </label>

                <label className="form-field">
                  <span>{t("再说两句", "Tell us about the project")}</span>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t("项目介绍及官方来源链接", "Project description and a link to an official source")}
                    minLength={10}
                    maxLength={1200}
                    required
                  />
                  <small>{notes.length}/1200</small>
                </label>

                <Button className="primary-button" type="submit" disabled={submit.status === "submitting"}>
                  {submit.status === "submitting" ? t("正在递过去…", "Submitting…") : t("提交加入提议", "Submit suggestion")}
                </Button>

                {submit.status === "error" && (
                  <p className="verify-notice verify-notice-error" role="status">{submit.message}</p>
                )}
              </form>
            )}
          </section>
        )}

        <div className="project-results-summary">
          <div className="project-results-count">
            {!catalogLoading && !catalogError && (
              <span role="status">{t(
                String(visibleProjects.length) + " 个项目",
                String(visibleProjects.length) + (visibleProjects.length === 1 ? " project" : " projects"),
              )}</span>
            )}
            {tag && <span className="project-active-topic">{tag}</span>}
          </div>
          {(query || tag || topicQuery || favoritesOnly) && (
            <button className="project-clear-filters" type="button" onClick={clearFilters}>
              {t("清除筛选", "Clear filters")}
            </button>
          )}
        </div>

        {catalogError ? <p role="alert" className="verify-notice verify-notice-error">{catalogError}</p> : catalogLoading ? (
          <p className="project-list-placeholder" role="status">{t("正在加载项目…", "Loading projects…")}</p>
        ) : visibleProjects.length === 0 ? (
          <p className="project-list-placeholder">{t("没有匹配的项目。", "No matching projects.")}</p>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((project) => {
              const isFavorite = favorites.isFavorite(project.repo);
              return (
                <Card className="project-card" key={project.repo}>
                  <div className="project-card-head">
                    <h2>
                      <a href={project.url} target="_blank" rel="noreferrer">
                        {project.repo} <ExternalLinkIcon href={project.url} />
                      </a>
                    </h2>
                    <button
                      className="favorite-button"
                      type="button"
                      aria-label={isFavorite
                        ? t("取消收藏 " + project.name, "Remove " + project.name + " from favorites")
                        : t("收藏 " + project.name, "Add " + project.name + " to favorites")}
                      aria-pressed={isFavorite}
                      onClick={() => favorites.toggle(project.repo)}
                      title={t("收藏只保存在当前浏览器", "Favorites are stored in this browser")}
                    >
                      <AppIcon name="star" size={17} />
                    </button>
                  </div>
                  {project.tags.length > 0 && (
                    <div className="project-tags">
                      {project.tags.map((item) => (
                        <button
                          type="button"
                          className="project-topic"
                          key={item}
                          aria-label={t("筛选 " + item, "Filter by " + item)}
                          aria-pressed={tag === item}
                          onClick={() => setTag(item)}
                        >
                          <ProjectTopicIcon tag={item} />
                          <span>{item}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="project-description" title={project.description}>{project.description}</p>
                  <footer className="project-source">
                    <AppIcon name="users" size={16} />
                    <span>{t("来源", "Source")}</span>
                    {project.labUrl ? (
                      <a href={project.labUrl} target="_blank" rel="noreferrer">
                        {project.lab} <ExternalLinkIcon href={project.labUrl} size={12} />
                      </a>
                    ) : <span className="project-source-name">{project.lab}</span>}
                  </footer>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

import type { CampusProject } from "@leadboard/contracts";

export type ProjectSource = "campus" | "campus-recommendation" | "community";
type CatalogProject = CampusProject & { source: ProjectSource };
type RecommendedProject = Pick<CampusProject, "name" | "repo" | "description" | "tags"> & {
  source: Exclude<ProjectSource, "campus">;
  lab: string;
  labUrl?: string;
};

const recommendations: RecommendedProject[] = [
  {
    name: "Hallo",
    repo: "fudan-generative-vision/hallo",
    description: "根据音频驱动人像图片生成说话视频。",
    tags: ["计算机视觉", "多模态", "Python"],
    source: "campus-recommendation",
    lab: "复旦大学与上海创智学院生成式视觉联合实验室",
    labUrl: "https://github.com/fudan-generative-vision",
  },
  {
    name: "AnyGPT",
    repo: "OpenMOSS/AnyGPT",
    description: "探索文本、语音、图像和音乐的统一多模态生成。",
    tags: ["多模态", "生成式 AI", "Python"],
    source: "campus-recommendation",
    lab: "复旦大学 OpenMOSS",
    labUrl: "https://github.com/OpenMOSS",
  },
  {
    name: "DISC-FinLLM",
    repo: "FudanDISC/DISC-FinLLM",
    description: "面向中文金融咨询、文本分析和计算任务的模型与评测项目。",
    tags: ["中文 NLP", "金融", "Python"],
    source: "campus-recommendation",
    lab: "复旦大学数据智能与社会计算实验室",
    labUrl: "https://github.com/FudanDISC",
  },
  {
    name: "OpenCV",
    repo: "opencv/opencv",
    description: "提供图像处理、视频分析和计算机视觉算法。",
    tags: ["计算机视觉", "C++", "Python"],
    source: "community",
    lab: "OpenCV",
  },
  {
    name: "MarkItDown",
    repo: "microsoft/markitdown",
    description: "将 PDF、Office 文档和其他文件转换成 Markdown。",
    tags: ["文档处理", "工具", "Python"],
    source: "community",
    lab: "Microsoft",
  },
  {
    name: "vLLM",
    repo: "vllm-project/vllm",
    description: "提供大语言模型推理及在线服务工具。",
    tags: ["大模型", "推理部署", "Python"],
    source: "community",
    lab: "vLLM",
  },
  {
    name: "LangChain",
    repo: "langchain-ai/langchain",
    description: "用于构建大语言模型应用和智能体的框架。",
    tags: ["大模型", "开源框架", "Python"],
    source: "community",
    lab: "LangChain",
  },
  {
    name: "Docker Compose",
    repo: "docker/compose",
    description: "通过配置文件定义并运行多容器应用。",
    tags: ["工程工具", "容器", "Go"],
    source: "community",
    lab: "Docker",
  },
  {
    name: "Kubernetes",
    repo: "kubernetes/kubernetes",
    description: "用于部署、扩展和管理容器应用的平台。",
    tags: ["工程工具", "容器", "Go"],
    source: "community",
    lab: "Kubernetes",
  },
  {
    name: "Rust",
    repo: "rust-lang/rust",
    description: "Rust 语言编译器、标准库和工具的源码仓库。",
    tags: ["工程工具", "编程语言", "Rust"],
    source: "community",
    lab: "Rust 项目",
  },
];

export function getProjectCatalog(campusProjects: readonly CampusProject[]): CatalogProject[] {
  const publishedRepos = new Set(campusProjects.map((project) => project.repo.toLowerCase()));
  return [
    ...campusProjects.map((project): CatalogProject => ({ ...project, source: "campus" })),
    ...recommendations
      .filter((project) => !publishedRepos.has(project.repo.toLowerCase()))
      .map((project) => ({
        ...project,
        url: `https://github.com/${project.repo}`,
        labUrl: project.labUrl ?? null,
      })),
  ];
}

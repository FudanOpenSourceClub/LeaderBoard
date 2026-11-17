import type { CampusProject } from "@leadboard/contracts";
import { describe, expect, it } from "vitest";
import { getProjectCatalog } from "../src/lib/project-catalog";

describe("project discovery catalog", () => {
  it("prefers the approved campus entry if a recommended repository is later approved", () => {
    const approved: CampusProject = {
      name: "Hallo",
      repo: "Fudan-Generative-Vision/Hallo",
      url: "https://github.com/Fudan-Generative-Vision/Hallo",
      lab: "已审核实验室",
      labUrl: null,
      description: "已审核的项目描述",
      tags: ["计算机视觉"],
    };
    const catalog = getProjectCatalog([approved]);

    expect(catalog.filter((project) => project.repo.toLowerCase() === approved.repo.toLowerCase()))
      .toEqual([{ ...approved, source: "campus" }]);
    expect(catalog).toContainEqual(expect.objectContaining({
      repo: "opencv/opencv", source: "community",
    }));
  });
});

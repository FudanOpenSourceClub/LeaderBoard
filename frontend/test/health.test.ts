import { afterEach, expect, it, vi } from "vitest";
import { fetchHealth } from "../src/health";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { App } from "../src/App";
import { createMockApiClient } from "../src/api/mock";
import { FiltersProvider } from "../src/state/filters";

afterEach(() => vi.unstubAllGlobals());
it("consumes the shared health schema and forwards cancellation", async () => {
  const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" })));
  vi.stubGlobal("fetch", mocked);
  const signal = new AbortController().signal;
  await expect(fetchHealth(signal)).resolves.toEqual({ status: "ok" });
  expect(mocked).toHaveBeenCalledWith("/health", { signal });
});
it.each([
  () => new Response("failure", { status: 503 }),
  () => new Response(JSON.stringify({ status: "unexpected" })),
  () => new Response("not json"),
])("rejects unavailable or incompatible backends", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  await expect(fetchHealth()).rejects.toThrow();
});
it("renders the Fudan project board without a header status widget", () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(FiltersProvider, null,
        createElement(App, { api: createMockApiClient(), isMock: true }),
      ),
    ),
  );
  expect(html).not.toContain("服务正常");
  expect(html).not.toContain("服务异常");
  expect(html).toContain("复旦开源项目");
  expect(html).toContain("复旦开源达人");
  expect(html).not.toContain("校内开源项目");
  expect(html).not.toContain("校内开源达人");
  expect(html).toContain("加上我的项目");
  expect(html).toContain("复旦开源仓库必吃榜");
  expect(html).not.toContain("先放几个我们能核验的");
  expect(html).not.toContain("让每一份微小贡献都被看见");
});

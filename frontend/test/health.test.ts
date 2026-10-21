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
it("renders the refreshed campus board without a header service pill", () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(FiltersProvider, null,
        createElement(App, { api: createMockApiClient(), isMock: true }),
      ),
    ),
  );
  expect(html).toContain("校内开源项目");
  expect(html).toContain("探索开源作品");
  expect(html).toContain("提交项目");
  expect(html).toContain('aria-haspopup="listbox"');
  expect(html).not.toContain("服务正常");
  expect(html).not.toContain("先放几个我们能核验的");
});

it("renders the editorial contributors section and three-step join flow", () => {
  const routes = [
    { path: "/contributors", expected: "代码背后" },
    { path: "/join", expected: "三步加入" },
  ];
  for (const route of routes) {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: [route.path] },
        createElement(FiltersProvider, null,
          createElement(App, { api: createMockApiClient() }),
        ),
      ),
    );
    expect(html).toContain(route.expected);
  }
});

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createMockApiClient } from "../src/api/mock";
import { FiltersProvider } from "../src/state/filters";

vi.mock("../src/auth/session", () => ({
  WebsiteSessionProvider: ({ children }: { children: ReactNode }) => children,
  useWebsiteSession: () => ({
    loading: false,
    session: { authenticated: true, registered: true, login: "wumingXZ", isAdmin: false, canTag: false, role: null, csrfToken: "test-token" },
  }),
}));

function renderPage(path: string) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] },
      createElement(FiltersProvider, null,
        createElement(App, { api: createMockApiClient() }),
      ),
    ),
  );
}

function currentLinks(html: string, label: string) {
  const nav = html.match(new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>(.*?)</nav>`))?.[1];
  expect(nav).toBeDefined();
  const links = [...nav!.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)];
  const active = links.filter(([, attrs = ""]) => /(?:nav-link-active|mobile-tab-active)/.test(attrs));
  const current = links.filter(([, attrs = ""]) => attrs.includes('aria-current="page"'));
  expect(current).toEqual(active);
  return active.map(([, attrs = ""]) => attrs.match(/href="([^"]*)"/)?.[1]);
}

it.each([
  "/contributors/wumingXZ",
  "/contributors/wumingxz",
  "/contributors/WUMINGXZ/",
  "/contributors/wumingXZ?range=all",
])("highlights only My profile at %s", (path) => {
  const html = renderPage(path);
  expect(html).not.toContain('aria-label="功能导航"');
  expect(currentLinks(html, "底部导航")).toEqual(["/contributors/wumingXZ"]);
  expect(currentLinks(html, "主导航")).toEqual([]);
  expect(html.match(/<a\b[^>]*class="persistent-account"[^>]*>/)?.[0]).toContain('aria-current="page"');
});

it.each([
  "/contributors",
  "/contributors/",
  "/contributors/jimi-21",
  "/contributors/wumingXZ-other",
])("keeps the leaderboard active at %s", (path) => {
  const html = renderPage(path);
  expect(html).not.toContain('aria-label="功能导航"');
  for (const label of ["底部导航", "主导航"]) {
    expect(currentLinks(html, label)).toEqual(["/contributors"]);
  }
  const account = html.match(/<a\b[^>]*class="persistent-account"[^>]*>/)?.[0];
  expect(account).toBeDefined();
  expect(account).not.toContain('aria-current="page"');
});

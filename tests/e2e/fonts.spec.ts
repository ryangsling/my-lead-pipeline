import { expect, test } from "@playwright/test";

test("serves both Geist families from the app", async ({ page }) => {
  await page.goto("/login");
  const fonts = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement);
    return Promise.all(["--font-geist-sans", "--font-geist-mono"].map(async (variable) => {
      const family = root.getPropertyValue(variable).split(",")[0].trim();
      const loaded = await document.fonts.load(`16px ${family}`);
      return loaded.length;
    }));
  });
  expect(fonts.every((count) => count > 0)).toBe(true);
  const sources = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => new URL(entry.name)).filter((url) => url.pathname.endsWith(".woff2"))
    .map((url) => ({ path: url.pathname, local: url.origin === location.origin })));
  expect(sources.some(({ path }) => path.includes("GeistMono"))).toBe(true);
  expect(sources.some(({ path }) => path.includes("Geist_Variable"))).toBe(true);
  expect(sources.every(({ local }) => local)).toBe(true);
});

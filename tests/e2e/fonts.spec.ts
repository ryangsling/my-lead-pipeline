import { expect, test } from "@playwright/test";

test("serves DM Sans and Instrument Serif from the app", async ({ page }) => {
  await page.goto("/login");
  const fonts = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement);
    return Promise.all([["--font-dm-sans", "normal"], ["--font-instrument-serif", "italic"]].map(async ([variable, style]) => {
      const family = root.getPropertyValue(variable).split(",")[0].trim();
      const loaded = await document.fonts.load(`${style} 16px ${family}`);
      return loaded.length;
    }));
  });
  expect(fonts.every((count) => count > 0)).toBe(true);
  const sources = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => new URL(entry.name)).filter((url) => url.pathname.endsWith(".woff2"))
    .map((url) => ({ path: url.pathname, local: url.origin === location.origin })));
  expect(sources.some(({ path }) => path.includes("instrument_serif"))).toBe(true);
  expect(sources.some(({ path }) => path.includes("dm_sans"))).toBe(true);
  expect(sources.every(({ local }) => local)).toBe(true);
});

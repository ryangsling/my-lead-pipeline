import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const folder = "docs/screenshots";
const fixture = process.env.UI_SCREENSHOT_CONVERSATION;
const sizes = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

async function capture(page: Page, name: string, width: number) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true, animations: "disabled" });
}

for (const size of sizes) {
  test(`captures the admin pages at ${size.width}px`, async ({ page }) => {
    test.skip(!fixture, "Set UI_SCREENSHOT_CONVERSATION to a synthetic Bloom conversation ID.");
    await page.setViewportSize(size);
    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/w\//);

    const pages = [
      ["dashboard", "", "Dashboard"],
      ["conversations", "/conversations", "Conversations"],
      ["conversation-detail", `/conversations/${fixture}`, "Phone conversation"],
      ["appointments", "/appointments", "Appointments"],
      ["settings", "/settings", "Settings"],
    ];
    for (const [name, route, heading] of pages) {
      await page.goto(`/w/bloom${route}`);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await capture(page, name, size.width);
    }

    if (size.width === 390) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(page.getByRole("link", { name: "Appointments" })).toBeVisible();
      await page.getByRole("link", { name: "Appointments" }).click();
      await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
      await page.getByRole("button", { name: "Manage" }).first().click();
      await expect(page.getByRole("menuitem", { name: "Cancel" })).toBeVisible();
    }
  });

  test(`captures all booking steps at ${size.width}px`, async ({ page }) => {
    test.skip(!fixture, "Set UI_SCREENSHOT_CONVERSATION to opt in to writing screenshots.");
    await page.setViewportSize(size);
    await page.route("**/api/public/*/slots?*", (route) => route.fulfill({ json: {
      slots: [
        { start: "2030-01-15T10:00:00Z", end: "2030-01-15T10:45:00Z" },
        { start: "2030-01-15T11:30:00Z", end: "2030-01-15T12:15:00Z" },
        { start: "2030-01-16T13:30:00Z", end: "2030-01-16T14:15:00Z" },
      ],
    } }));
    await page.route("**/api/public/*/book", (route) => route.fulfill({ status: 201, json: { reference: "BLOOM123" } }));
    await page.goto("/book/bloom");
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
    await capture(page, "booking-1-service", size.width);
    await page.getByRole("button", { name: /cut and finish/i }).click();
    const days = page.getByRole("group", { name: "Days" });
    await days.getByRole("button", { name: /wed/i }).click();
    await expect(page.getByRole("button", { name: "13:30" })).toBeVisible();
    await days.getByRole("button", { name: /tue/i }).click();
    await capture(page, "booking-2-time", size.width);
    await page.getByRole("button", { name: "10:00", exact: true }).click();
    await page.getByLabel("Name").fill("Maya Clarke");
    await page.getByLabel("Phone").fill("07700 900123");
    await capture(page, "booking-3-details", size.width);
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByRole("link", { name: "Add to calendar" })).toBeVisible();
    await capture(page, "booking-4-confirmation", size.width);
  });
}

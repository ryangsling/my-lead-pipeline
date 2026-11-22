import { expect, test } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL!;
const password = process.env.E2E_ADMIN_PASSWORD!;
const slug = `e2e-${Date.now()}`;

async function login(page: import("@playwright/test").Page, pw = password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a wrong password is refused", async ({ page }) => {
  await login(page, "definitely-wrong");
  await expect(page.getByText("Wrong email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signed-out visitors are sent to /login", async ({ page }) => {
  await page.goto("/workspaces/new");
  await expect(page).toHaveURL(/\/login/);
});

test("log in, create, switch, edit and archive a workspace", async ({ page }) => {
  await login(page);
  await page.waitForURL(/\/(w\/.+|workspaces\/new)$/);

  await page.goto("/workspaces/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Workspace");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Niche").fill("testing");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(`**/w/${slug}`);

  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: "Bloom Salon" }).click();
  await page.waitForURL("**/w/bloom");
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: "E2E Workspace" }).click();
  await page.waitForURL(`**/w/${slug}`);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Niche").fill("edited");
  await page.getByLabel("Accent colour (optional)").fill("#b7def1");
  await page.getByLabel("Logo URL (optional)").fill("https://example.test/logo.svg");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Niche")).toHaveValue("edited");
  await expect(page.getByLabel("Accent colour (optional)")).toHaveValue("#b7def1");
  await expect(page.getByLabel("Logo URL (optional)")).toHaveValue("https://example.test/logo.svg");
  await page.route("https://example.test/logo.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="blue"/></svg>',
  }));
  await page.goto(`/book/${slug}`);
  await expect(page.getByRole("heading", { name: "Book with E2E Workspace" })).toBeVisible();
  await expect(page.locator("header img")).toHaveJSProperty("naturalWidth", 16);
  await expect(page.locator("main")).toHaveCSS("--booking-accent", "#b7def1");
  await expect(page.locator("main")).toHaveCSS("--booking-on-accent", "#000000");

  await page.goto(`/w/${slug}/integrations`);
  const key = page.locator("#vapi-privateKey");
  await key.fill("sk-fake-secret-abcd");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await page.reload();
  await expect(key).toHaveValue("****abcd");
  await expect(page.locator("body")).not.toContainText("sk-fake-secret");

  await page.goto(`/w/${slug}/settings`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const archived = page.waitForResponse((r) => r.request().method() === "DELETE" && r.ok());
  await page.getByRole("button", { name: "Archive workspace" }).click();
  await archived;
  await page.goto(`/w/${slug}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

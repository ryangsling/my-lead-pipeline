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

  await page.getByLabel("Workspace").selectOption("bloom");
  await page.waitForURL("**/w/bloom");
  await page.getByLabel("Workspace").selectOption(slug);
  await page.waitForURL(`**/w/${slug}`);

  await page.getByLabel("Niche").fill("edited");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("Niche")).toHaveValue("edited");

  await page.goto(`/w/${slug}/settings`);
  const key = page.locator("#vapi-privateKey");
  await key.fill("sk-fake-secret-abcd");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await page.reload();
  await expect(key).toHaveValue("****abcd");
  await expect(page.locator("body")).not.toContainText("sk-fake-secret");

  await page.goto(`/w/${slug}`);
  const archived = page.waitForResponse((r) => r.request().method() === "DELETE" && r.ok());
  await page.getByRole("button", { name: "Archive" }).click();
  await archived;
  await page.goto(`/w/${slug}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

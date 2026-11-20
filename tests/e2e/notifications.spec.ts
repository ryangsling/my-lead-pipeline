import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { client, db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const slug = `e2e-notify-${Date.now()}`;

test.afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, slug));
  await client.end();
});

test("add a channel, save it, and see it again after a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(w\/.+|workspaces\/new)$/);

  await page.goto("/workspaces/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Notify");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Niche").fill("testing");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(`**/w/${slug}`);

  await page.goto(`/w/${slug}/notifications`);
  await page.getByRole("button", { name: "Add channel" }).click();
  await page.getByLabel("Type").selectOption("email");
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByRole("button", { name: "Save channels" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();

  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Save channels" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email address")).toHaveValue("owner@example.com");
  await expect(page.getByRole("button", { name: "Send test" })).toBeEnabled();
  await expect(page.getByText("Nothing sent yet.")).toBeVisible();
});

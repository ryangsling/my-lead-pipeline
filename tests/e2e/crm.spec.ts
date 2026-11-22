import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, conversations, messages, workspaces } from "@/lib/db/schema";

const slug = `e2e-crm-${Date.now()}`;

test.afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.slug, slug));
});

test("a seeded conversation shows in the list, with transcript and tool calls in its detail", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(w\/.+|workspaces\/new)$/);

  await page.goto("/workspaces/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E CRM");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Niche").fill("testing");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(`**/w/${slug}`);

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  const [contact] = await db
    .insert(contacts)
    .values({ workspaceId: workspace.id, name: "Ada Lovelace", phoneE164: "+447700900123", source: "phone" })
    .returning();
  const [conversation] = await db
    .insert(conversations)
    .values({
      workspaceId: workspace.id,
      contactId: contact.id,
      channel: "phone",
      externalId: "e2e_call",
      durationS: 75,
      costUsd: "0.0238",
      outcome: "booked",
      summary: "Booked a cut for Tuesday.",
      structured: { service: "Cut", booked: true },
    })
    .returning();
  await db.insert(messages).values([
    { workspaceId: workspace.id, conversationId: conversation.id, role: "assistant", content: "Hi, this is the AI assistant", createdAt: new Date("2030-01-01T10:00:00Z") },
    { workspaceId: workspace.id, conversationId: conversation.id, role: "tool_call", toolName: "book_appointment", content: '{"service":"Cut"}', createdAt: new Date("2030-01-01T10:00:05Z") },
    { workspaceId: workspace.id, conversationId: conversation.id, role: "tool_result", toolName: "book_appointment", content: "You are booked in.", createdAt: new Date("2030-01-01T10:00:06Z") },
  ]);

  await page.goto(`/w/${slug}/conversations`);
  await expect(page.getByText("Booked a cut for Tuesday.")).toBeVisible();
  await expect(page.getByText("1:15")).toBeVisible();
  await page.getByRole("link", { name: /\d{1,2} \w{3}, \d{2}:\d{2}/ }).click();

  await expect(page.getByText("Hi, this is the AI assistant")).toBeVisible();
  await expect(page.getByText("Tool call book_appointment:")).toBeVisible();
  await expect(page.getByText("You are booked in.")).toBeVisible();
  await expect(page.getByText("Service", { exact: true })).toBeVisible();

  await page.goto(`/w/${slug}/contacts`);
  await page.getByLabel("Search").fill("lovelace");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await expect(page.getByText("booked", { exact: false }).first()).toBeVisible();
});

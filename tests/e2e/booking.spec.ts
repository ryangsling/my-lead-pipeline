import { expect, test } from "@playwright/test";
import { DateTime } from "luxon";

// Bloom exists in the real database, but Google is not connected there, so the two public API calls are
// mocked in the browser. The page, the workspace lookup and the 404 are real.
const at = (hour: number) => DateTime.now().setZone("Europe/London").plus({ days: 2 }).set({ hour, minute: 0, second: 0, millisecond: 0 });
const slot = (hour: number) => ({ start: at(hour).toISO({ suppressMilliseconds: true }), end: at(hour + 1).toISO({ suppressMilliseconds: true }) });

test("an unknown slug gives 404", async ({ page }) => {
  const response = await page.goto("/book/no-such-business");
  expect(response?.status()).toBe(404);
});

test("books a slot and shows the reference", async ({ page }) => {
  let booked: Record<string, unknown> | null = null;
  await page.route("**/api/public/*/slots*", (route) =>
    route.fulfill({ json: { timezone: "Europe/London", slots: [slot(10), slot(11)] } }),
  );
  await page.route("**/api/public/*/book", async (route) => {
    booked = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { appointment: { id: "x" }, reference: "ABCD1234" } });
  });

  await page.goto("/book/bloom");
  await expect(page.getByRole("heading", { name: /Book with/ })).toBeVisible();
  await page.getByRole("button", { name: "10:00" }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Phone").fill("07700 900123");
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("You are booked in.")).toBeVisible();
  await expect(page.getByText(/Your reference is ABCD1234/)).toBeVisible();
  expect(booked).toMatchObject({ name: "Ada Lovelace", phone: "07700 900123", start: slot(10).start });
});

test("a taken slot shows the message and disappears from the list", async ({ page }) => {
  let taken = false;
  await page.route("**/api/public/*/slots*", (route) =>
    route.fulfill({ json: { timezone: "Europe/London", slots: taken ? [slot(11)] : [slot(10), slot(11)] } }),
  );
  await page.route("**/api/public/*/book", async (route) => {
    taken = true;
    await route.fulfill({ status: 409, json: { error: "That slot was just taken." } });
  });

  await page.goto("/book/bloom");
  await page.getByRole("button", { name: "10:00" }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Phone").fill("07700 900123");
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("That slot was just taken.")).toBeVisible();
  await expect(page.getByRole("button", { name: "10:00" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "11:00" })).toBeVisible();
});

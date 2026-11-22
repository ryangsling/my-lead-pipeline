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
  await page.getByRole("button", { name: /cut and finish/i }).click();
  await page.getByRole("button", { name: "10:00" }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Phone").fill("07700 900123");
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("You are booked in.")).toBeVisible();
  await expect(page.getByText(/Your reference is ABCD1234/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("download", "appointment.ics");
  expect(booked).toMatchObject({ name: "Ada Lovelace", phone: "07700 900123", start: slot(10).start });
});

test("distinguishes repeated times and keeps the chosen offset through confirmation", async ({ page }) => {
  const first = { start: "2027-10-31T01:30:00+01:00", end: "2027-10-31T01:00:00+00:00", repeatedTimeOffset: "UTC+01:00" };
  const second = { start: "2027-10-31T01:30:00+00:00", end: "2027-10-31T02:00:00+00:00", repeatedTimeOffset: "UTC+00:00" };
  let booked: Record<string, unknown> | null = null;
  await page.route("**/api/public/*/slots*", (route) =>
    route.fulfill({ json: { timezone: "Europe/London", slots: [first, second] } }),
  );
  await page.route("**/api/public/*/book", async (route) => {
    booked = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { appointment: { id: "x" }, reference: "ABCD1234" } });
  });

  await page.goto("/book/bloom");
  await page.getByRole("button", { name: /cut and finish/i }).click();
  await expect(page.getByRole("button", { name: "01:30 (UTC+01:00)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "01:30 (UTC+00:00)", exact: true }).click();
  await expect(page.getByText(/at 01:30 \(UTC\+00:00\)/)).toBeVisible();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Phone").fill("07700 900123");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByText("You are booked in.")).toBeVisible();
  await expect(page.getByText(/at 01:30 \(UTC\+00:00\)/)).toBeVisible();
  expect(booked).toMatchObject({ start: second.start });
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
  await page.getByRole("button", { name: /cut and finish/i }).click();
  await page.getByRole("button", { name: "10:00" }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Phone").fill("07700 900123");
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText("That slot was just taken.")).toBeVisible();
  await expect(page.getByRole("button", { name: "10:00" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "11:00" })).toBeVisible();
});

import { describe, expect, it } from "vitest";
import { renderPrompt } from "@/lib/agent/prompt";
import type { services } from "@/lib/db/schema";
import type { WorkspaceView } from "@/lib/workspaces";

const workspace = {
  name: "Bloom Salon",
  timezone: "Europe/London",
  businessInfo: { hours: "Mon to Fri 9:00 to 17:30" },
} as unknown as WorkspaceView;

const workspaceServices = [
  { name: "Cut and finish", durationMin: 45, priceText: "from £30", active: true },
  { name: "Colour", durationMin: 90, priceText: null, active: true },
  { name: "Retired", durationMin: 10, priceText: null, active: false },
] as unknown as (typeof services.$inferSelect)[];

describe("renderPrompt", () => {
  it("fills every variable from workspace data", () => {
    const template = "{{business_name}} | {{services}} | {{hours}} | {{timezone}}";
    expect(renderPrompt(template, workspace, workspaceServices)).toBe(
      "Bloom Salon | Cut and finish (45 min, from £30); Colour (90 min) | Mon to Fri 9:00 to 17:30 | Europe/London",
    );
  });

  it("keeps {{today}} as a Liquid expression with the workspace timezone", () => {
    const rendered = renderPrompt("Today is {{today}}", workspace, workspaceServices);
    expect(rendered).toBe('Today is {{"now" | date: "%A %d %B %Y", "Europe/London"}}');
    expect(rendered).not.toContain("{{today}}");
  });

  it("leaves unknown variables alone", () => {
    expect(renderPrompt("{{unknown}}", workspace, workspaceServices)).toBe("{{unknown}}");
  });
});

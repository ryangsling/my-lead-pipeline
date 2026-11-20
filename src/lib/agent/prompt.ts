import type { services } from "@/lib/db/schema";
import { readBusinessInfo, type WorkspaceView } from "@/lib/workspaces";

/**
 * Fills the prompt template. `{{today}}` stays a Liquid expression so Vapi renders
 * the real date at call time (D6).
 */
export function renderPrompt(
  template: string,
  workspace: WorkspaceView,
  workspaceServices: (typeof services.$inferSelect)[],
): string {
  const servicesText = workspaceServices
    .filter((s) => s.active)
    .map((s) => `${s.name} (${s.durationMin} min${s.priceText ? `, ${s.priceText}` : ""})`)
    .join("; ");
  const today = `{{"now" | date: "%A %d %B %Y", "${workspace.timezone}"}}`;
  const hours = readBusinessInfo(workspace.businessInfo).hours;

  return template
    .replaceAll("{{business_name}}", workspace.name)
    .replaceAll("{{services}}", servicesText)
    .replaceAll("{{hours}}", hours)
    .replaceAll("{{timezone}}", workspace.timezone)
    .replaceAll("{{today}}", today);
}

import { notFound } from "next/navigation";
import { IntegrationForm } from "@/components/integration-form";
import { providerNames, providers } from "@/lib/integrations/providers";
import { toView } from "@/lib/integrations/service";
import { getExactIntegration } from "@/lib/integrations/store";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function WorkspaceSettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  const overridable = providerNames.filter((p) => providers[p].override);
  const views = await Promise.all(overridable.map(async (p) => toView(p, await getExactIntegration(p, w.id))));
  return (
    <>
      <h1 className="mb-1 text-xl font-medium">Settings for {w.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">Leave a form empty to use the global key.</p>
      <div className="grid max-w-xl gap-4">
        {views.map((v) => (
          <IntegrationForm key={v.provider} provider={v.provider} workspaceId={w.id} initial={JSON.parse(JSON.stringify(v))} />
        ))}
      </div>
    </>
  );
}

import Link from "next/link";
import { AdminHeader } from "@/components/admin-header";
import { IntegrationForm } from "@/components/integration-form";
import { requireAdminOrRedirect } from "@/lib/auth";
import { providerNames } from "@/lib/integrations/providers";
import { toView } from "@/lib/integrations/service";
import { getExactIntegration } from "@/lib/integrations/store";

export default async function IntegrationsPage() {
  await requireAdminOrRedirect();
  const views = await Promise.all(providerNames.map(async (p) => toView(p, await getExactIntegration(p, null))));
  return (
    <>
      <AdminHeader />
      <main className="space-y-4 p-4">
        <h1 className="text-xl font-medium">Integrations</h1>
        <p className="text-sm text-muted-foreground">Global keys, used by every workspace unless it has its own.</p>
        <Link href="/settings/integrations/chat-providers" className="text-sm font-medium underline">Manage chat providers</Link>
        <div className="grid max-w-xl gap-4">
          {views.map((v) => (
            <IntegrationForm key={v.provider} provider={v.provider} initial={JSON.parse(JSON.stringify(v))} />
          ))}
        </div>
      </main>
    </>
  );
}

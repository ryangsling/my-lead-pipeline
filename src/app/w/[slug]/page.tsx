import { notFound } from "next/navigation";
import { WorkspaceForm } from "@/components/workspace-form";
import { getWorkspaceBySlug, readBusinessInfo } from "@/lib/workspaces";

export default async function WorkspacePage({ params }: PageProps<"/w/[slug]">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();
  return (
    <>
      <h1 className="mb-4 text-xl font-medium">{w.name}</h1>
      <WorkspaceForm
        id={w.id}
        initial={{
          name: w.name,
          slug: w.slug,
          niche: w.niche ?? "",
          country: w.country,
          timezone: w.timezone,
          phoneDisplay: w.phoneDisplay ?? "",
          vapiMode: w.vapiMode as "own" | "pool",
          businessInfo: readBusinessInfo(w.businessInfo),
        }}
      />
    </>
  );
}

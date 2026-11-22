import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { requireAdminOrRedirect } from "@/lib/auth";
import { getWorkspaceBySlug, listWorkspaces } from "@/lib/workspaces";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  await requireAdminOrRedirect();
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace || workspace.status === "archived") notFound();
  const items = (await listWorkspaces()).map(({ slug, name }) => ({ slug, name }));
  return <AdminShell workspace={{ slug, name: workspace.name }} items={items}>{children}</AdminShell>;
}

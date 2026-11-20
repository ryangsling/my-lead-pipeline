import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin-header";
import { requireAdminOrRedirect } from "@/lib/auth";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  await requireAdminOrRedirect();
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace || workspace.status === "archived") notFound();
  return (
    <>
      <AdminHeader current={slug} />
      <main className="p-4">{children}</main>
    </>
  );
}

import { AdminHeader } from "@/components/admin-header";
import { emptyWorkspace, WorkspaceForm } from "@/components/workspace-form";
import { requireAdminOrRedirect } from "@/lib/auth";

export default async function NewWorkspacePage() {
  await requireAdminOrRedirect();
  return (
    <>
      <AdminHeader />
      <main className="p-4">
        <h1 className="mb-4 text-xl font-medium">New workspace</h1>
        <WorkspaceForm initial={emptyWorkspace} />
      </main>
    </>
  );
}

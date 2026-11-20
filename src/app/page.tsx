import { redirect } from "next/navigation";
import { requireAdminOrRedirect } from "@/lib/auth";
import { listWorkspaces } from "@/lib/workspaces";

export default async function Home() {
  await requireAdminOrRedirect();
  const [first] = await listWorkspaces();
  redirect(first ? `/w/${first.slug}` : "/workspaces/new");
}

import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { listWorkspaces } from "@/lib/workspaces";

export async function AdminHeader({ current }: { current?: string }) {
  const items = (await listWorkspaces()).map(({ slug, name }) => ({ slug, name }));
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="font-medium">Agent Hub</span>
        <WorkspaceSwitcher items={items} current={current} />
        <Link href="/settings/integrations" className="text-sm underline">Integrations</Link>
        {current && <Link href={`/w/${current}/agent`} className="text-sm underline">Agent</Link>}
        {current && <Link href={`/w/${current}/booking`} className="text-sm underline">Booking</Link>}
        {current && <Link href={`/w/${current}/appointments`} className="text-sm underline">Appointments</Link>}
        {current && <Link href={`/w/${current}/conversations`} className="text-sm underline">Conversations</Link>}
        {current && <Link href={`/w/${current}/contacts`} className="text-sm underline">Contacts</Link>}
        {current && <Link href={`/w/${current}/notifications`} className="text-sm underline">Notifications</Link>}
        {current && <Link href={`/w/${current}/settings`} className="text-sm underline">Workspace settings</Link>}
        {current && <Link href={`/w/${current}`} className="text-sm underline">Workspace</Link>}
      </div>
      <form action={logout}>
        <Button type="submit" variant="outline" size="sm">Sign out</Button>
      </form>
    </header>
  );
}

"use client";

import { Activity, Bell, CalendarCheck, CalendarDays, LayoutDashboard, LogOut, MessagesSquare, Plug, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

const navigation = [
  ["Dashboard", "", LayoutDashboard],
  ["Conversations", "/conversations", MessagesSquare],
  ["Appointments", "/appointments", CalendarCheck],
  ["Contacts", "/contacts", Users],
  ["Agent", "/agent", Activity],
  ["Booking", "/booking", CalendarDays],
  ["Notifications", "/notifications", Bell],
  ["Integrations", "/integrations", Plug],
  ["Settings", "/settings", Settings],
] as const;

type Workspace = { slug: string; name: string };

function WorkspaceNavigation({ workspace, items }: { workspace: Workspace; items: Workspace[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const prefix = `/w/${workspace.slug}`;
  return (
    <Sidebar>
      <SidebarHeader className="gap-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="text-2xl font-medium tracking-tight text-foreground" onClick={() => setOpenMobile(false)}>
            Incodet<span className="text-accent">.</span>
          </Link>
          <SidebarTrigger className="md:hidden" aria-label="Close navigation" />
        </div>
        <WorkspaceSwitcher items={items} current={workspace.slug} onNavigate={() => setOpenMobile(false)} />
      </SidebarHeader>
      <SidebarContent className="px-3">
        <nav aria-label="Workspace navigation">
          <SidebarMenu className="gap-1.5">
            {navigation.map(([label, suffix, Icon]) => {
              const href = prefix + suffix;
              const active = pathname === href || (suffix !== "" && pathname.startsWith(`${href}/`));
              return (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={active}
                    className="min-h-10 rounded-full px-3 text-sm data-[active=true]:bg-[#18264b] data-[active=true]:text-white"
                    render={<Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)} />}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-3 p-5">
        <Separator />
        <form action={logout}>
          <Button variant="outline" className="w-full justify-start gap-2" type="submit"><LogOut /> Sign out</Button>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AdminShell({ workspace, items, children }: { workspace: Workspace; items: Workspace[]; children: ReactNode }) {
  return (
    <SidebarProvider className="incodet-admin">
      <WorkspaceNavigation workspace={workspace} items={items} />
      <SidebarInset id="admin-content" className="min-w-0 bg-background text-foreground">
        <header className="flex h-16 items-center gap-3 border-b px-5">
          <SidebarTrigger variant="outline" aria-label="Toggle navigation" />
          <span className="truncate text-sm font-medium text-muted-foreground">{workspace.name}</span>
        </header>
        <div className="mx-auto w-full max-w-7xl px-5 py-6 md:px-8 md:py-8">{children}</div>
      </SidebarInset>
      <Toaster theme="dark" />
    </SidebarProvider>
  );
}

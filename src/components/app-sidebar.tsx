import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  BookOpen,
  Megaphone,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  Sparkles,
  KeyRound,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, usePermissions } from "@/hooks/use-auth";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  disabled?: boolean;
};
const adminNavItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bootcamps", label: "Bootcamps", icon: GraduationCap },
  { to: "/students", label: "Students", icon: Users },
  { to: "/lessons", label: "Lessons", icon: BookOpen },
  { to: "/lessons/test-brain", label: "Test AI brain", icon: Sparkles },
  { to: "/announcements", label: "Announcements", icon: Megaphone },
  { to: "/questions", label: "Questions", icon: MessageSquare },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings, disabled: true },
];

const teacherNavItems: NavItem[] = [
  { to: "/dashboard", label: "My Bootcamps", icon: GraduationCap },
  { to: "/lessons", label: "Lessons", icon: BookOpen },
  { to: "/announcements", label: "Announcements", icon: Megaphone },
  { to: "/questions", label: "Questions", icon: MessageSquare },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { data: perms } = usePermissions();
  const navItems = perms?.isTeacher ? teacherNavItems : adminNavItems;
  const roleLabel = perms?.isPlatformAdmin
    ? "Platform admin"
    : perms?.isTeacher
      ? "Teacher"
      : "Bootcamp admin";

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="h-14 flex items-center px-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
            BC
          </div>
          <span className="font-semibold tracking-tight">Bootcamp Admin</span>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          if (item.disabled) {
            return (
              <div
                key={item.to}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground/60 cursor-not-allowed"
                title="Coming in next phase"
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider">soon</span>
              </div>
            );
          }
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.to === "/questions" ? <QuestionsBadge /> : null}
            </Link>
          );
        })}
        {perms?.isPlatformAdmin && (
          <>
            <Link
              to="/admin/password-requests"
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                pathname.startsWith("/admin/password-requests")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80",
              )}
            >
              <KeyRound className="h-4 w-4" />
              <span>Password requests</span>
            </Link>
            <Link
              to="/admin/recycle-bin"
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                pathname.startsWith("/admin/recycle-bin")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground/80",
              )}
            >
              <Trash2 className="h-4 w-4" />
              <span>Recycle bin</span>
            </Link>
          </>
        )}

      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-accent text-accent-foreground grid place-items-center text-xs font-medium">
            {initials(user?.user_metadata?.first_name, user?.user_metadata?.last_name) || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user?.email}</div>
            <div className="text-[11px] text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start mt-1" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

function QuestionsBadge() {
  const { data: perms } = usePermissions();
  const accessibleIds = [
    ...(perms?.adminBootcampIds ?? []),
    ...(perms?.teacherBootcampIds ?? []),
  ];
  const { data: count } = useQuery({
    queryKey: ["unreviewed-questions-count", perms?.isPlatformAdmin, accessibleIds.join(",")],
    enabled: !!perms,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("review_status", "unreviewed")
        .gte("created_at", since);
      if (!perms?.isPlatformAdmin) {
        if (accessibleIds.length === 0) return 0;
        q = q.in("bootcamp_id", accessibleIds);
      }
      const { count } = await q;
      return count ?? 0;
    },
  });
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

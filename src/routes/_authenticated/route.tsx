import { createFileRoute, Outlet, redirect, Link, useRouterState } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segments = pathname.split("/").filter(Boolean);
  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card px-5 flex items-center text-sm text-muted-foreground">
          <nav className="flex items-center gap-1.5">
            <Link to="/dashboard" className="hover:text-foreground">Home</Link>
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span>/</span>
                <span className="capitalize text-foreground">{decodeURIComponent(seg)}</span>
              </span>
            ))}
          </nav>
        </header>
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}

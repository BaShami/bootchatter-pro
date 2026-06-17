import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useCurrentUser(): User | null {
  const { user } = useSession();
  return user;
}

/** Returns platform role + admin bootcamp ids for the current user. */
export function usePermissions() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["permissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: roles }, { data: members }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
        supabase.from("bootcamp_members").select("bootcamp_id, role").eq("user_id", user!.id),
      ]);
      const isPlatformAdmin = (roles ?? []).some((r) => r.role === "platform_admin");
      const adminBootcampIds = (members ?? [])
        .filter((m) => m.role === "admin")
        .map((m) => m.bootcamp_id as string);
      return { isPlatformAdmin, adminBootcampIds };
    },
  });
}

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BootcampMemberProfile = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export type BootcampMemberWithProfile = {
  id: string;
  user_id: string;
  role: Database["public"]["Enums"]["bootcamp_role"];
  status?: string;
  profiles: BootcampMemberProfile | null;
};

/** Fetch bootcamp members and merge profile rows without PostgREST FK embeds. */
export async function fetchBootcampMembersWithProfiles(
  bootcampId: string,
  role?: Database["public"]["Enums"]["bootcamp_role"],
  memberStatus?: "active" | "suspended",
): Promise<BootcampMemberWithProfile[]> {
  let membersQuery = supabase
    .from("bootcamp_members")
    .select("id, user_id, role, status")
    .eq("bootcamp_id", bootcampId);

  if (role) {
    membersQuery = membersQuery.eq("role", role);
  }
  if (memberStatus) {
    membersQuery = membersQuery.eq("status", memberStatus);
  }

  const { data: members, error: membersError } = await membersQuery;
  if (membersError) throw membersError;
  if (!members?.length) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", userIds);

  if (profilesError) throw profilesError;

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, { email: p.email, first_name: p.first_name, last_name: p.last_name }]),
  );

  return members.map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    status: (m as { status?: string }).status,
    profiles: profileById.get(m.user_id) ?? null,
  }));
}

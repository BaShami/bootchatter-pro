import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const memberInput = z.object({
  bootcamp_id: z.string().uuid(),
  member_id: z.string().uuid(),
});

const historyInput = z.object({ bootcamp_id: z.string().uuid() });

type AuthContext = {
  supabase: {
    from: (table: string) => any;
  };
  userId: string;
};

async function getMemberWithProfile(
  supabase: AuthContext["supabase"],
  memberId: string,
  bootcampId: string,
) {
  const { data: member, error } = await supabase
    .from("bootcamp_members")
    .select("id, user_id, role, bootcamp_id")
    .eq("id", memberId)
    .eq("bootcamp_id", bootcampId)
    .eq("role", "teacher")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) throw new Error("Teacher not found");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, first_name, last_name")
    .eq("id", member.user_id)
    .maybeSingle();

  return { member, profile };
}

async function recordHistory(
  supabase: AuthContext["supabase"],
  params: {
    bootcamp_id: string;
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    role: string;
    action: "suspended" | "removed";
    actioned_by: string;
  },
) {
  const { error } = await supabase.from("teacher_history").insert({
    bootcamp_id: params.bootcamp_id,
    user_id: params.user_id,
    email: params.email,
    first_name: params.first_name,
    last_name: params.last_name,
    role: params.role,
    action: params.action,
    actioned_by: params.actioned_by,
  });
  if (error) throw new Error(error.message);
}

export const suspendTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => memberInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { member, profile } = await getMemberWithProfile(
      supabase,
      data.member_id,
      data.bootcamp_id,
    );

    const { error } = await supabase
      .from("bootcamp_members")
      .update({ status: "suspended" })
      .eq("id", member.id);
    if (error) throw new Error(error.message);

    await recordHistory(supabase, {
      bootcamp_id: data.bootcamp_id,
      user_id: member.user_id,
      email: profile?.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      role: member.role,
      action: "suspended",
      actioned_by: userId,
    });

    return { ok: true };
  });

export const removeTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => memberInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { member, profile } = await getMemberWithProfile(
      supabase,
      data.member_id,
      data.bootcamp_id,
    );

    await recordHistory(supabase, {
      bootcamp_id: data.bootcamp_id,
      user_id: member.user_id,
      email: profile?.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      role: member.role,
      action: "removed",
      actioned_by: userId,
    });

    const { error } = await supabase.from("bootcamp_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const listTeacherHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => historyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("teacher_history")
      .select("id, email, first_name, last_name, action, actioned_at")
      .eq("bootcamp_id", data.bootcamp_id)
      .order("actioned_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { history: rows ?? [] };
  });

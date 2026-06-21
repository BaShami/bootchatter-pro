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

const userInput = z.object({ user_id: z.string().uuid() });

export const getTeacherProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => userInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name")
      .eq("id", data.user_id)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("User not found");

    const { data: memberships, error: memError } = await supabase
      .from("bootcamp_members")
      .select("bootcamp_id, role, status")
      .eq("user_id", data.user_id);
    if (memError) throw new Error(memError.message);

    const bootcampIds = (memberships ?? []).map((m) => m.bootcamp_id);
    let bootcampNames = new Map<string, string>();
    if (bootcampIds.length) {
      const { data: bcs } = await supabase.from("bootcamps").select("id, name").in("id", bootcampIds);
      for (const b of bcs ?? []) bootcampNames.set(b.id, b.name);
    }

    const bootcamps = (memberships ?? []).map((m) => ({
      id: m.bootcamp_id,
      name: bootcampNames.get(m.bootcamp_id) ?? m.bootcamp_id,
      role: m.role,
      status: (m as { status?: string }).status ?? "active",
    }));

    const roles = Array.from(new Set((memberships ?? []).map((m) => m.role)));

    const { data: announcements, error: annError } = await supabase
      .from("announcements")
      .select("id, title, created_at, delivered_count, status")
      .eq("created_by", data.user_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (annError) throw new Error(annError.message);

    const { data: lessons, error: lessonError } = await supabase
      .from("lessons")
      .select("id, title, status, created_at")
      .eq("created_by", data.user_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (lessonError) throw new Error(lessonError.message);

    return {
      profile,
      bootcamps,
      roles,
      announcements: announcements ?? [],
      lessons: lessons ?? [],
    };
  });

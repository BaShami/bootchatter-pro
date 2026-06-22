import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const triggerStudentOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ student_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Look up the student's bootcamp using the caller's RLS-scoped client so
    // unauthorized users can't even discover the student exists.
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("bootcamp_id")
      .eq("id", data.student_id)
      .maybeSingle();
    if (studentError) throw new Error(studentError.message);
    if (!student) throw new Error("Student not found");

    const { data: isAdmin, error: roleError } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: student.bootcamp_id,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { fireStudentOnboardingWebhook } = await import("@/lib/student-webhook.server");
    await fireStudentOnboardingWebhook(data.student_id);
    return { ok: true };
  });

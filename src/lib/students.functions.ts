import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ConsentInput = z.object({
  student_id: z.string().uuid(),
  consent_status: z.enum(["pending", "granted", "revoked"]),
});

export const updateStudentConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConsentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: student, error } = await supabase
      .from("students")
      .select("id, bootcamp_id")
      .eq("id", data.student_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!student) throw new Error("Student not found");

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: student.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden: only bootcamp admins can update student consent");

    const { error: updateErr } = await supabase
      .from("students")
      .update({ consent_status: data.consent_status })
      .eq("id", data.student_id);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true };
  });

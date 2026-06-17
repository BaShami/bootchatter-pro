/**
 * Admin tester for the AI brain. Uses the SAME askQuestion function as the
 * public Make.com endpoint, but does not log to the questions table and
 * returns full debug. Admin-only (bootcamp admin of the student's bootcamp).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  student_id: z.string().uuid(),
  question: z.string().trim().min(2).max(2000),
});

export const testAskQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: student } = await supabase
      .from("students")
      .select("id, bootcamp_id")
      .eq("id", data.student_id)
      .maybeSingle();
    if (!student) throw new Error("Student not found");

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: student.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { askQuestion } = await import("@/lib/ask-question.server");
    return askQuestion({
      studentId: student.id,
      bootcampId: student.bootcamp_id,
      question: data.question,
      log: false,
      includeDebug: true,
    });
  });

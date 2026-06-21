import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const triggerStudentOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ student_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { fireStudentOnboardingWebhook } = await import("@/lib/student-webhook.server");
    await fireStudentOnboardingWebhook(data.student_id);
    return { ok: true };
  });

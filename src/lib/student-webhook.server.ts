export async function fireStudentOnboardingWebhook(studentId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: student, error: studentError } = await supabaseAdmin
    .from("students")
    .select(
      "id, first_name, last_name, phone_number, email, enrollment_status, consent_status, enrolled_at, bootcamp_id",
    )
    .eq("id", studentId)
    .maybeSingle();

  if (studentError) {
    console.error("[fireStudentOnboardingWebhook] student fetch failed:", studentError);
    return;
  }
  if (!student) {
    console.error("[fireStudentOnboardingWebhook] student not found:", studentId);
    return;
  }

  const { data: bootcamp, error: bootcampError } = await supabaseAdmin
    .from("bootcamps")
    .select("id, name")
    .eq("id", student.bootcamp_id)
    .maybeSingle();

  if (bootcampError) {
    console.error("[fireStudentOnboardingWebhook] bootcamp fetch failed:", bootcampError);
    return;
  }
  if (!bootcamp) {
    console.error("[fireStudentOnboardingWebhook] bootcamp not found:", student.bootcamp_id);
    return;
  }

  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("bootcamp_settings")
    .select("student_onboarding_webhook_url")
    .eq("bootcamp_id", student.bootcamp_id)
    .maybeSingle();

  if (settingsError) {
    console.error("[fireStudentOnboardingWebhook] settings fetch failed:", settingsError);
    return;
  }

  const webhookUrl = settings?.student_onboarding_webhook_url?.trim();
  if (!webhookUrl) return;

  const payload = {
    event: "student_added",
    student: {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      phone_number: student.phone_number,
      email: student.email,
      enrollment_status: student.enrollment_status,
      consent_status: student.consent_status,
      enrolled_at: student.enrolled_at,
    },
    bootcamp: {
      id: bootcamp.id,
      name: bootcamp.name,
    },
    template: {
      name: "student_welcome",
      variables: {
        "1": student.first_name,
        "2": bootcamp.name,
      },
    },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(
        "[fireStudentOnboardingWebhook] webhook non-2xx",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.error("[fireStudentOnboardingWebhook] webhook error", e);
  }
}

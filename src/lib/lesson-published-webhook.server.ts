export async function fireLessonPublishedWebhook(lessonId: string, bootcampId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: lesson, error: lessonError } = await supabaseAdmin
    .from("lessons")
    .select("id, title, summary, learning_objectives, key_topics")
    .eq("id", lessonId)
    .maybeSingle();

  if (lessonError) {
    console.error("[fireLessonPublishedWebhook] lesson fetch failed:", lessonError);
    return;
  }
  if (!lesson) {
    console.error("[fireLessonPublishedWebhook] lesson not found:", lessonId);
    return;
  }

  const { data: bootcamp, error: bootcampError } = await supabaseAdmin
    .from("bootcamps")
    .select("id, name")
    .eq("id", bootcampId)
    .maybeSingle();

  if (bootcampError) {
    console.error("[fireLessonPublishedWebhook] bootcamp fetch failed:", bootcampError);
    return;
  }
  if (!bootcamp) {
    console.error("[fireLessonPublishedWebhook] bootcamp not found:", bootcampId);
    return;
  }

  const { data: students, error: studentsError } = await supabaseAdmin
    .from("students")
    .select("id, first_name, phone_number")
    .eq("bootcamp_id", bootcampId)
    .eq("enrollment_status", "active");

  if (studentsError) {
    console.error("[fireLessonPublishedWebhook] students fetch failed:", studentsError);
    return;
  }

  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("bootcamp_settings")
    .select("make_webhook_url")
    .eq("bootcamp_id", bootcampId)
    .maybeSingle();

  if (settingsError) {
    console.error("[fireLessonPublishedWebhook] settings fetch failed:", settingsError);
    return;
  }

  const webhookUrl = settings?.make_webhook_url?.trim();
  if (!webhookUrl) return;

  const payload = {
    event: "lesson_published",
    lesson: {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
    },
    students: (students ?? []).map((s) => ({
      id: s.id,
      first_name: s.first_name,
      phone_number: s.phone_number,
    })),
    bootcamp: {
      id: bootcamp.id,
      name: bootcamp.name,
    },
    template: {
      name: "lesson_summary",
      variables: {
        "1": "STUDENT_FIRST_NAME_PLACEHOLDER",
        "2": "LESSON_TITLE_PLACEHOLDER",
        "3": "LESSON_SUMMARY_PLACEHOLDER",
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
        "[fireLessonPublishedWebhook] webhook non-2xx",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.error("[fireLessonPublishedWebhook] webhook error", e);
  }
}

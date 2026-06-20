import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createInput = z.object({
  bootcamp_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  audience_type: z.enum(["all", "specific"]),
  student_ids: z.array(z.string().uuid()).max(5000).nullable().optional(),
  save_as_draft: z.boolean().optional(),
});

const idInput = z.object({ id: z.string().uuid() });
const bootcampInput = z.object({ bootcamp_id: z.string().uuid() });

async function assertCanWrite(supabase: any, userId: string, bootcampId: string) {
  const { data: isTeacher, error } = await supabase.rpc("is_bootcamp_teacher", {
    _user_id: userId,
    _bootcamp_id: bootcampId,
  });
  if (error) throw new Error(error.message);
  if (!isTeacher) throw new Error("You don't have access to this bootcamp");
}

/** Create an announcement and its recipient rows. */
export const createAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanWrite(supabase, userId, data.bootcamp_id);

    // Resolve recipient student ids
    let studentIds: string[] = [];
    if (data.audience_type === "all") {
      const { data: rows, error } = await supabase
        .from("students")
        .select("id")
        .eq("bootcamp_id", data.bootcamp_id)
        .eq("enrollment_status", "active")
        .eq("consent_status", "granted");
      if (error) throw new Error(error.message);
      studentIds = (rows ?? []).map((r) => r.id);
    } else {
      studentIds = Array.from(new Set(data.student_ids ?? []));
      if (studentIds.length === 0) throw new Error("Pick at least one student");
      // Verify all belong to this bootcamp
      const { data: rows, error } = await supabase
        .from("students")
        .select("id")
        .eq("bootcamp_id", data.bootcamp_id)
        .in("id", studentIds);
      if (error) throw new Error(error.message);
      const allowed = new Set((rows ?? []).map((r) => r.id));
      studentIds = studentIds.filter((id) => allowed.has(id));
      if (studentIds.length === 0) {
        throw new Error("None of the selected students belong to this bootcamp");
      }
    }

    const { data: announcement, error: insertError } = await supabase
      .from("announcements")
      .insert({
        bootcamp_id: data.bootcamp_id,
        title: data.title,
        message: data.message,
        audience_type: data.audience_type,
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    if (studentIds.length > 0) {
      const rows = studentIds.map((sid) => ({
        announcement_id: announcement.id,
        student_id: sid,
        processing_status: "pending" as const,
      }));
      const { error: recError } = await supabase
        .from("announcement_recipients")
        .insert(rows);
      if (recError) {
        await supabase.from("announcements").delete().eq("id", announcement.id);
        throw new Error(recError.message);
      }
    }

    return { id: announcement.id, recipient_count: studentIds.length };
  });

/** Send: POST one webhook per recipient, update statuses + counters. */
export const sendAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ann, error: annError } = await supabase
      .from("announcements")
      .select("id, bootcamp_id, title, message, status")
      .eq("id", data.id)
      .maybeSingle();
    if (annError) throw new Error(annError.message);
    if (!ann) throw new Error("Announcement not found");
    await assertCanWrite(supabase, userId, ann.bootcamp_id);
    if (ann.status === "completed") throw new Error("Already sent");

    const { data: bootcamp, error: bcError } = await supabase
      .from("bootcamps")
      .select("id, name")
      .eq("id", ann.bootcamp_id)
      .single();
    if (bcError) throw new Error(bcError.message);

    const { data: settings, error: setError } = await supabase
      .from("bootcamp_settings")
      .select("make_webhook_url")
      .eq("bootcamp_id", ann.bootcamp_id)
      .maybeSingle();
    if (setError) throw new Error(setError.message);
    const webhookUrl = settings?.make_webhook_url?.trim();
    if (!webhookUrl) {
      throw new Error(
        "No Make webhook URL configured for this bootcamp. Set it in bootcamp settings.",
      );
    }

    const { data: recipients, error: recError } = await supabase
      .from("announcement_recipients")
      .select("id, student_id, students:student_id (id, first_name, last_name, phone_number)")
      .eq("announcement_id", ann.id);
    if (recError) throw new Error(recError.message);
    if (!recipients?.length) throw new Error("No recipients to send to");

    await supabase
      .from("announcements")
      .update({ status: "processing" })
      .eq("id", ann.id);

    const sentAt = new Date().toISOString();
    const payloads: unknown[] = [];
    let delivered = 0;
    let failed = 0;

    for (const r of recipients) {
      const student = (r as any).students ?? null;
      const payload = {
        announcement_id: ann.id,
        student: student
          ? {
              id: student.id,
              first_name: student.first_name,
              last_name: student.last_name,
              phone_number: student.phone_number,
            }
          : { id: r.student_id },
        bootcamp: { id: bootcamp.id, name: bootcamp.name },
        message: { title: ann.title, body: ann.message },
        sent_at: sentAt,
      };
      payloads.push(payload);

      let ok = false;
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        ok = res.ok;
        if (!ok) {
          console.error(
            "[sendAnnouncement] webhook non-2xx",
            res.status,
            await res.text().catch(() => ""),
          );
        }
      } catch (e) {
        console.error("[sendAnnouncement] webhook error", e);
        ok = false;
      }

      if (ok) delivered++;
      else failed++;

      await supabase
        .from("announcement_recipients")
        .update({ processing_status: ok ? "sent" : "failed" })
        .eq("id", r.id);
    }

    await supabase
      .from("announcements")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
        webhook_payload: payloads as never,
        delivered_count: delivered,
        failed_count: failed,
      })
      .eq("id", ann.id);

    return { delivered, failed, total: recipients.length };
  });

/** List announcements for a bootcamp. */
export const listAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bootcampInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("announcements")
      .select(
        "id, title, message, audience_type, status, delivered_count, failed_count, processed_at, created_at",
      )
      .eq("bootcamp_id", data.bootcamp_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    let countsById = new Map<string, number>();
    if (ids.length) {
      const { data: recs, error: re } = await context.supabase
        .from("announcement_recipients")
        .select("announcement_id")
        .in("announcement_id", ids);
      if (re) throw new Error(re.message);
      for (const r of recs ?? []) {
        countsById.set(r.announcement_id, (countsById.get(r.announcement_id) ?? 0) + 1);
      }
    }

    return {
      announcements: (rows ?? []).map((r) => ({
        ...r,
        recipient_count: countsById.get(r.id) ?? 0,
      })),
    };
  });

/** Get one announcement + its recipients (with student detail). */
export const getAnnouncementDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ann, error } = await supabase
      .from("announcements")
      .select(
        "id, bootcamp_id, title, message, audience_type, status, delivered_count, failed_count, processed_at, created_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ann) throw new Error("Announcement not found");

    const { data: recipients, error: rerr } = await supabase
      .from("announcement_recipients")
      .select(
        "id, processing_status, student_id, students:student_id (id, first_name, last_name, phone_number)",
      )
      .eq("announcement_id", ann.id);
    if (rerr) throw new Error(rerr.message);

    return { announcement: ann, recipients: recipients ?? [] };
  });

/** Update Make webhook URL for a bootcamp (admins only via RLS). */
export const updateMakeWebhookUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        bootcamp_id: z.string().uuid(),
        make_webhook_url: z
          .string()
          .trim()
          .max(2000)
          .url()
          .or(z.literal(""))
          .transform((v) => (v ? v : null)),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bootcamp_settings")
      .update({ make_webhook_url: data.make_webhook_url })
      .eq("bootcamp_id", data.bootcamp_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Get webhook URL for a bootcamp (members only via RLS). */
export const getBootcampWebhook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bootcampInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("bootcamp_settings")
      .select("make_webhook_url")
      .eq("bootcamp_id", data.bootcamp_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { make_webhook_url: row?.make_webhook_url ?? null };
  });

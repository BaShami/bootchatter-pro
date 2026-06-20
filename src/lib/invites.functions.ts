import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const createInput = z.object({
  email: z.string().trim().email().max(255),
  bootcamp_ids: z.array(z.string().uuid()).min(1).max(50),
});

const acceptInput = z.object({
  token: z.string().uuid(),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(72),
});

const tokenInput = z.object({ token: z.string().uuid() });
const idInput = z.object({ id: z.string().uuid() });
const bootcampInput = z.object({ bootcamp_id: z.string().uuid() });

/** Bootcamp admin (or platform admin) creates a teacher invite. */
export const createTeacherInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const email = data.email.toLowerCase();

    // Verify caller is admin on every bootcamp in the list (or platform_admin)
    const { data: isPlatform } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "platform_admin",
    });
    if (!isPlatform) {
      for (const bid of data.bootcamp_ids) {
        const { data: ok, error } = await supabase.rpc("is_bootcamp_admin", {
          _user_id: userId,
          _bootcamp_id: bid,
        });
        if (error) throw new Error(error.message);
        if (!ok) throw new Error("Not an admin on one of the selected bootcamps");
      }
    }

    const { data: row, error } = await supabase
      .from("invites")
      .insert({
        email,
        bootcamp_ids: data.bootcamp_ids,
        role: "teacher",
        created_by: userId,
      })
      .select("id, token, email, bootcamp_ids, expires_at, status")
      .single();
    if (error) throw new Error(error.message);

    return { invite: row, url: `/invite/${row.token}` };
  });

/** List invites that touch a given bootcamp. */
export const listBootcampInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bootcampInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("invites")
      .select("id, email, bootcamp_ids, status, token, expires_at, created_at, accepted_at")
      .contains("bootcamp_ids", [data.bootcamp_id])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invites: rows ?? [] };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Public lookup for the invite acceptance page. */
export const getInviteByToken = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenInput.parse(d))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
    );
    const { data: rows, error } = await client.rpc("get_invite_by_token", { _token: data.token });
    if (error) throw new Error(error.message);
    const invite = Array.isArray(rows) ? rows[0] : rows;
    if (!invite) return { invite: null as null };
    return { invite };
  });

/** Public: accept an invite — creates the auth user, profile, and bootcamp memberships. */
export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => acceptInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inviteRow, error: lookupError } = await supabaseAdmin
      .from("invites")
      .select("id, email, bootcamp_ids, role, status, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!inviteRow) throw new Error("Invite not found");
    if (inviteRow.status !== "pending") throw new Error("Invite already used or revoked");
    if (new Date(inviteRow.expires_at).getTime() < Date.now()) {
      throw new Error("Invite has expired");
    }

    // Create the auth user (email-confirmed so they can sign in immediately).
    const { data: created, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: inviteRow.email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          first_name: data.first_name,
          last_name: data.last_name,
        },
      });
    if (createError || !created.user) {
      throw new Error(createError?.message ?? "Could not create account");
    }
    const newUserId = created.user.id;

    // The handle_new_user trigger creates the profile; ensure first/last name are set.
    await supabaseAdmin
      .from("profiles")
      .update({ first_name: data.first_name, last_name: data.last_name })
      .eq("id", newUserId);

    // Memberships
    const memberships = inviteRow.bootcamp_ids.map((bid: string) => ({
      bootcamp_id: bid,
      user_id: newUserId,
      role: inviteRow.role,
    }));
    const { error: memberError } = await supabaseAdmin
      .from("bootcamp_members")
      .insert(memberships);
    if (memberError) {
      // Roll back the auth user so the invite stays usable.
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(memberError.message);
    }

    await supabaseAdmin
      .from("invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_user_id: newUserId,
      })
      .eq("id", inviteRow.id);

    return { ok: true, email: inviteRow.email };
  });

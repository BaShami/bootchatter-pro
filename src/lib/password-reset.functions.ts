import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const emailInput = z.object({ email: z.string().trim().email().max(255) });
const actionInput = z.object({ request_id: z.string().uuid() });

/** Public: anyone can request a password reset. Always returns ok to avoid enumeration. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => emailInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    // Always record the request — even if no user matches, so the queue can show "unknown email".
    await supabaseAdmin.from("password_reset_requests").insert({
      email,
      user_id: profile?.id ?? null,
      status: "pending",
    });

    return { ok: true };
  });

/** Platform admin: list pending password reset requests. */
export const listPasswordResetRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "platform_admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: rows, error } = await supabase
      .from("password_reset_requests")
      .select("id, email, user_id, requested_at, actioned_at, status")
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { requests: rows ?? [] };
  });

function generateTempPassword(): string {
  // 16 chars, mixed case + digits + 2 symbols. Avoid ambiguous chars.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*?";
  const all = upper + lower + digits + symbols;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  // Force at least one from each pool for complexity.
  chars.push(upper[bytes[0] % upper.length]);
  chars.push(lower[bytes[1] % lower.length]);
  chars.push(digits[bytes[2] % digits.length]);
  chars.push(symbols[bytes[3] % symbols.length]);
  for (let i = 4; i < bytes.length; i++) chars.push(all[bytes[i] % all.length]);
  // Simple shuffle.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Platform admin: auto-generate a temporary password, set it on the user, mark request actioned. */
export const actionPasswordResetRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "platform_admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqError } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id, user_id, email, status")
      .eq("id", data.request_id)
      .maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request already handled");
    if (!req.user_id) throw new Error("No user is registered with that email");

    const tempPassword = generateTempPassword();
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      req.user_id,
      { password: tempPassword },
    );
    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin
      .from("password_reset_requests")
      .update({
        status: "actioned",
        actioned_at: new Date().toISOString(),
        actioned_by: userId,
      })
      .eq("id", req.id);

    // Returned once, never stored.
    return { ok: true, email: req.email, temp_password: tempPassword };
  });

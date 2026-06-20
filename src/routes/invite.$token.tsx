import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { acceptInvite, getInviteByToken } from "@/lib/invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Accept invite · Bootcamp Admin" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const lookup = useServerFn(getInviteByToken);
  const accept = useServerFn(acceptInvite);

  const inviteQ = useQuery({
    queryKey: ["invite", token],
    queryFn: () => lookup({ data: { token } }),
    retry: false,
  });

  useEffect(() => {
    document.title = "Accept invite · Bootcamp Admin";
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const first_name = String(form.get("first_name") ?? "").trim();
    const last_name = String(form.get("last_name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (!first_name || !last_name) return toast.error("Name fields required");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");

    setBusy(true);
    try {
      const res = await accept({
        data: { token, first_name, last_name, password },
      });
      const { error } = await supabase.auth.signInWithPassword({
        email: res.email,
        password,
      });
      if (error) {
        toast.success("Account created — please sign in");
        navigate({ to: "/auth", replace: true });
        return;
      }
      toast.success("Welcome!");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setBusy(false);
    }
  }

  const invite = inviteQ.data?.invite;
  const invalid =
    !inviteQ.isLoading &&
    (!invite || invite.status !== "pending" || invite.expired);

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accept your invite</CardTitle>
          <CardDescription>
            Set your name and a password to join your bootcamp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inviteQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : invalid ? (
            <div className="space-y-3">
              <p className="text-sm">
                {!invite
                  ? "This invite link is not valid."
                  : invite.status === "accepted"
                    ? "This invite has already been used."
                    : invite.status === "revoked"
                      ? "This invite has been revoked."
                      : "This invite has expired. Ask the admin to send a new one."}
              </p>
              <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={invite!.email} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Bootcamps</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(invite!.bootcamp_names ?? []).map((n: string) => (
                    <Badge key={n} variant="outline">{n}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name">First name</Label>
                  <Input id="first_name" name="first_name" required maxLength={80} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input id="last_name" name="last_name" required maxLength={80} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" minLength={8} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" name="confirm" type="password" minLength={8} required />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Accept invite"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <Toaster richColors position="top-right" />
    </div>
  );
}

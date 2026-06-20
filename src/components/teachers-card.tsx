import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, Copy, X, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createTeacherInvite,
  listBootcampInvites,
  revokeInvite,
} from "@/lib/invites.functions";

type Profile = { email?: string; first_name?: string; last_name?: string } | null;

export function TeachersCard({ bootcampId }: { bootcampId: string }) {
  const teachers = useQuery({
    queryKey: ["bootcamp-teachers", bootcampId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bootcamp_members")
        .select(
          "id, user_id, role, profiles:profiles!bootcamp_members_user_id_fkey(email, first_name, last_name)",
        )
        .eq("bootcamp_id", bootcampId)
        .eq("role", "teacher");
      if (error) throw error;
      return data ?? [];
    },
  });

  const listFn = useServerFn(listBootcampInvites);
  const invites = useQuery({
    queryKey: ["bootcamp-invites", bootcampId],
    queryFn: () => listFn({ data: { bootcamp_id: bootcampId } }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Teachers</CardTitle>
        <InviteTeacherDialog bootcampId={bootcampId} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Active</div>
          {teachers.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : teachers.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teachers yet.</p>
          ) : (
            <ul className="space-y-2">
              {teachers.data?.map((m) => {
                const p = m.profiles as Profile;
                return (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">
                        {p?.first_name ?? ""} {p?.last_name ?? ""}
                      </div>
                      <div className="text-xs text-muted-foreground">{p?.email ?? m.user_id}</div>
                    </div>
                    <Badge variant="outline">teacher</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Pending invites
          </div>
          {invites.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : !invites.data?.invites.length ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <ul className="space-y-2">
              {invites.data.invites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} bootcampId={bootcampId} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InviteRow({
  invite,
  bootcampId,
}: {
  invite: {
    id: string;
    email: string;
    status: string;
    token: string;
    expires_at: string;
    accepted_at: string | null;
  };
  bootcampId: string;
}) {
  const qc = useQueryClient();
  const revoke = useServerFn(revokeInvite);
  const revokeMut = useMutation({
    mutationFn: () => revoke({ data: { id: invite.id } }),
    onSuccess: () => {
      toast.success("Invite revoked");
      qc.invalidateQueries({ queryKey: ["bootcamp-invites", bootcampId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expired = new Date(invite.expires_at).getTime() < Date.now();
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${invite.token}`;
  const statusLabel = invite.status === "accepted"
    ? "accepted"
    : invite.status === "revoked"
      ? "revoked"
      : expired
        ? "expired"
        : "pending";

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{invite.email}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {statusLabel === "pending"
            ? `expires ${new Date(invite.expires_at).toLocaleDateString()}`
            : statusLabel}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {invite.status === "pending" && !expired && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(url);
                toast.success("Invite link copied");
              }}
              title="Copy invite link"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => revokeMut.mutate()}
              disabled={revokeMut.isPending}
              title="Revoke"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function InviteTeacherDialog({ bootcampId }: { bootcampId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([bootcampId]);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: bootcamps } = useBootcamps();
  const create = useServerFn(createTeacherInvite);

  const mutation = useMutation({
    mutationFn: () =>
      create({ data: { email, bootcamp_ids: selectedIds } }),
    onSuccess: (res) => {
      const fullUrl = `${window.location.origin}${res.url}`;
      setCreatedUrl(fullUrl);
      qc.invalidateQueries({ queryKey: ["bootcamp-invites", bootcampId] });
      toast.success("Invite created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() {
    setEmail("");
    setSelectedIds([bootcampId]);
    setCreatedUrl(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus className="h-4 w-4 mr-1.5" /> Invite teacher
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teacher</DialogTitle>
          <DialogDescription>
            They get a link to set their password and accept access to the bootcamps you pick.
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3">
            <p className="text-sm">Share this link (expires in 72 hours):</p>
            <div className="flex gap-2">
              <Input readOnly value={createdUrl} className="text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(createdUrl);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return toast.error("Email required");
              if (selectedIds.length === 0) return toast.error("Pick at least one bootcamp");
              mutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bootcamp access</Label>
              <div className="border border-border rounded-md max-h-48 overflow-y-auto p-2 space-y-1.5">
                {(bootcamps ?? []).map((b) => {
                  const checked = selectedIds.includes(b.id);
                  return (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setSelectedIds((prev) =>
                            v ? [...new Set([...prev, b.id])] : prev.filter((x) => x !== b.id),
                          );
                        }}
                      />
                      <span>{b.name}</span>
                    </label>
                  );
                })}
                {!bootcamps?.length && (
                  <p className="text-xs text-muted-foreground">No bootcamps available.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

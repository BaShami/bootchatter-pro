import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Save, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBootcamp } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { fetchBootcampMembersWithProfiles } from "@/lib/bootcamp-members";
import { BootcampKnowledgeBaseCard } from "@/components/bootcamp-kb-card";
import { TeachersCard } from "@/components/teachers-card";
import { MakeWebhookCard } from "@/components/make-webhook-card";
import { BootcampOnboardingChecklist } from "@/components/bootcamp-onboarding-checklist";

export const Route = createFileRoute("/_authenticated/bootcamps/$id")({
  head: () => ({ meta: [{ title: "Bootcamp · Bootcamp Admin" }] }),
  component: BootcampDetail,
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(80),
  status: z.enum(["draft", "active", "completed", "archived"]),
});

function BootcampDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: bootcamp, isLoading, isError, error, refetch } = useBootcamp(id);

  const studentCount = useQuery({
    queryKey: ["bootcamp-counts", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ count: students }, { count: lessons }, { count: questions }] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("bootcamp_id", id!),
        supabase.from("lessons").select("id", { count: "exact", head: true }).eq("bootcamp_id", id!),
        supabase.from("questions").select("id", { count: "exact", head: true }).eq("bootcamp_id", id!),
      ]);
      return { students: students ?? 0, lessons: lessons ?? 0, questions: questions ?? 0 };
    },
  });

  const members = useQuery({
    queryKey: ["bootcamp-members", id],
    enabled: !!id,
    queryFn: () => fetchBootcampMembersWithProfiles(id!, "admin"),
  });

  const update = useMutation({
    mutationFn: async (input: z.infer<typeof updateSchema>) => {
      const { error } = await supabase
        .from("bootcamps")
        .update({
          name: input.name,
          description: input.description || null,
          start_date: input.start_date || null,
          end_date: input.end_date || null,
          timezone: input.timezone,
          status: input.status,
        })
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bootcamp saved");
      qc.invalidateQueries({ queryKey: ["bootcamps"] });
      qc.invalidateQueries({ queryKey: ["bootcamps", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = updateSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    update.mutate(parsed.data);
  }

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="Could not load bootcamp" />
        <p className="text-sm text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Something went wrong while loading this bootcamp."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/bootcamps" })}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to bootcamps
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!bootcamp) {
    return (
      <div>
        <PageHeader title="Bootcamp not found" />
        <Button variant="outline" onClick={() => navigate({ to: "/bootcamps" })}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to bootcamps
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Link to="/bootcamps" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center mb-3">
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> All bootcamps
      </Link>
      <PageHeader
        title={bootcamp.name}
        description={bootcamp.description ?? undefined}
        actions={<Badge variant="outline">{bootcamp.status}</Badge>}
      />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mb-6">
        <MetricCard label="Students" value={studentCount.data?.students ?? 0} />
        <MetricCard label="Lessons" value={studentCount.data?.lessons ?? 0} />
        <MetricCard label="Questions" value={studentCount.data?.questions ?? 0} />
        <MetricCard label="Created" value={formatDate(bootcamp.created_at)} />
      </div>

      <div className="mb-6">
        <BootcampOnboardingChecklist bootcampId={id!} />
      </div>


      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Bootcamp details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={bootcamp.name} required maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" defaultValue={bootcamp.description ?? ""} rows={3} maxLength={2000} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start_date">Start date</Label>
                  <Input id="start_date" name="start_date" type="date" defaultValue={bootcamp.start_date ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date">End date</Label>
                  <Input id="end_date" name="end_date" type="date" defaultValue={bootcamp.end_date ?? ""} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" name="timezone" defaultValue={bootcamp.timezone} maxLength={80} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <Select name="status" defaultValue={bootcamp.status}>
                    <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={update.isPending}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {update.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Admins</CardTitle>
            <AddAdminDialog bootcampId={id!} />
          </CardHeader>
          <CardContent>
            {members.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : members.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No additional admins yet.</p>
            ) : (
              <ul className="space-y-2">
                {members.data?.map((m) => {
                  const p = (m.profiles as { email?: string; first_name?: string; last_name?: string } | null) ?? null;
                  return (
                    <li key={m.id} className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{p?.first_name ?? ""} {p?.last_name ?? ""}</div>
                        <div className="text-xs text-muted-foreground">{p?.email ?? m.user_id}</div>
                      </div>
                      <Badge variant="outline">{m.role}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <TeachersCard bootcampId={id!} />
        </div>
        <div className="lg:col-span-1">
          <BootcampKnowledgeBaseCard bootcampId={id!} />
        </div>
        <div className="lg:col-span-1">
          <MakeWebhookCard bootcampId={id!} />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function AddAdminDialog({ bootcampId }: { bootcampId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error("No user with that email has signed up yet. Ask them to register first.");
      const { error: insertError } = await supabase
        .from("bootcamp_members")
        .insert({ bootcamp_id: bootcampId, user_id: profile.id, role: "admin" });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast.success("Admin added");
      qc.invalidateQueries({ queryKey: ["bootcamp-members", bootcampId] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    mutation.mutate(email);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus className="h-4 w-4 mr-1.5" /> Add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bootcamp admin</DialogTitle>
          <DialogDescription>The user must already have an account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" name="email" type="email" required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Adding…" : "Add admin"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

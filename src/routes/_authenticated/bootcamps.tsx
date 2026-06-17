import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { usePermissions } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/bootcamps")({
  head: () => ({ meta: [{ title: "Bootcamps · Bootcamp Admin" }] }),
  component: BootcampsPage,
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(80),
  status: z.enum(["draft", "active", "completed", "archived"]),
});

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  completed: "bg-success/15 text-success",
  archived: "bg-muted text-muted-foreground line-through",
};

function BootcampsPage() {
  const { data: bootcamps, isLoading } = useBootcamps();
  const { data: perms } = usePermissions();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = (bootcamps ?? []).filter(
    (b) =>
      !q ||
      b.name.toLowerCase().includes(q.toLowerCase()) ||
      (b.description ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Bootcamps"
        description="Manage cohorts. Each bootcamp keeps its students, lessons, and AI knowledge isolated."
        actions={
          perms?.isPlatformAdmin ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1.5" /> New bootcamp
                </Button>
              </DialogTrigger>
              <CreateBootcampDialog onDone={() => setOpen(false)} />
            </Dialog>
          ) : null
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bootcamps…"
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <h3 className="font-medium">No bootcamps yet</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {perms?.isPlatformAdmin
                ? "Create your first bootcamp to start adding students and lessons."
                : "You haven't been assigned to a bootcamp yet. Ask a platform admin to add you."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <Link
              key={b.id}
              to="/bootcamps/$id"
              params={{ id: b.id }}
              className="block group"
            >
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold leading-tight">{b.name}</h3>
                    <Badge variant="outline" className={STATUS_STYLES[b.status] ?? ""}>
                      {b.status}
                    </Badge>
                  </div>
                  {b.description ? (
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{b.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/70 italic mt-2">No description</p>
                  )}
                  <div className="text-xs text-muted-foreground mt-4 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Starts {formatDate(b.start_date)}</span>
                    <span>Ends {formatDate(b.end_date)}</span>
                    <span>{b.timezone}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateBootcampDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: z.infer<typeof createSchema>) => {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        name: input.name,
        description: input.description || null,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        timezone: input.timezone,
        status: input.status,
        created_by: user.user?.id ?? null,
      };
      const { data, error } = await supabase.from("bootcamps").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Bootcamp created");
      qc.invalidateQueries({ queryKey: ["bootcamps"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = createSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    mutation.mutate(parsed.data);
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New bootcamp</DialogTitle>
        <DialogDescription>You can edit any of this later.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required maxLength={120} placeholder="e.g. Cohort 5 — Automation" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} maxLength={2000} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start date</Label>
            <Input id="start_date" name="start_date" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_date">End date</Label>
            <Input id="end_date" name="end_date" type="date" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              required
              defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue="draft">
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
        <DialogFooter>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create bootcamp"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

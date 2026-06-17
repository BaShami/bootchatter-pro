import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Search, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { useLessons } from "@/hooks/use-lessons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/lessons")({
  head: () => ({ meta: [{ title: "Lessons · Bootcamp Admin" }] }),
  component: LessonsPage,
});

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  ready: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  failed: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground line-through",
};

function LessonsPage() {
  const { data: bootcamps, isLoading: bootcampsLoading } = useBootcamps();
  const [bootcampId, setBootcampId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!bootcampId && bootcamps && bootcamps.length > 0) {
      setBootcampId(bootcamps[0].id);
    }
  }, [bootcamps, bootcampId]);

  const { data: lessons, isLoading } = useLessons(bootcampId);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () =>
      (lessons ?? []).filter((l) => {
        if (statusFilter !== "all" && l.status !== statusFilter) return false;
        if (!q) return true;
        const t = q.toLowerCase();
        return (
          l.title.toLowerCase().includes(t) ||
          (l.module_name ?? "").toLowerCase().includes(t) ||
          (l.summary ?? "").toLowerCase().includes(t)
        );
      }),
    [lessons, q, statusFilter],
  );

  return (
    <div>
      <PageHeader
        title="Lessons"
        description="Upload transcripts, generate knowledge, and publish lessons for the AI assistant."
        actions={
          bootcampId ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1.5" /> New lesson
                </Button>
              </DialogTrigger>
              <CreateLessonDialog
                bootcampId={bootcampId}
                onDone={() => setOpen(false)}
              />
            </Dialog>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select
          value={bootcampId ?? ""}
          onValueChange={(v) => setBootcampId(v)}
          disabled={bootcampsLoading || !bootcamps?.length}
        >
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Select bootcamp" />
          </SelectTrigger>
          <SelectContent>
            {(bootcamps ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search lessons…"
            className="pl-9"
          />
        </div>
      </div>

      {!bootcampId ? (
        <EmptyState text="Create a bootcamp first to add lessons." />
      ) : isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState text="No lessons yet. Create one to start building your AI knowledge base." />
      ) : (
        <div className="grid gap-3">
          {filtered.map((l) => (
            <Link
              key={l.id}
              to="/lessons/$id"
              params={{ id: l.id }}
              className="block group"
            >
              <Card className="transition-colors group-hover:border-primary/40">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 justify-between">
                      <div className="min-w-0">
                        <h3 className="font-medium truncate">
                          {l.lesson_number != null && (
                            <span className="text-muted-foreground mr-1.5">
                              #{l.lesson_number}
                            </span>
                          )}
                          {l.title}
                        </h3>
                        {l.module_name ? (
                          <p className="text-xs text-muted-foreground">{l.module_name}</p>
                        ) : null}
                      </div>
                      <Badge variant="outline" className={STATUS_STYLES[l.status] ?? ""}>
                        {l.status}
                      </Badge>
                    </div>
                    {l.summary ? (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {l.summary}
                      </p>
                    ) : null}
                    <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Lesson date {formatDate(l.lesson_date)}</span>
                      {l.published_at ? (
                        <span>Published {formatDate(l.published_at)}</span>
                      ) : null}
                    </div>
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

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-10 text-center text-sm text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  );
}

const createSchema = z.object({
  title: z.string().trim().min(2).max(180),
  module_name: z.string().trim().max(120).optional().or(z.literal("")),
  lesson_number: z.string().optional().or(z.literal("")),
  lesson_date: z.string().optional().or(z.literal("")),
});

function CreateLessonDialog({
  bootcampId,
  onDone,
}: {
  bootcampId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async (input: z.infer<typeof createSchema>) => {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lessons")
        .insert({
          bootcamp_id: bootcampId,
          title: input.title,
          module_name: input.module_name || null,
          lesson_number: input.lesson_number ? Number(input.lesson_number) : null,
          lesson_date: input.lesson_date || null,
          status: "draft",
          created_by: user.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Lesson created — paste or upload the transcript next");
      qc.invalidateQueries({ queryKey: ["lessons", bootcampId] });
      onDone();
      if (data?.id) navigate({ to: "/lessons/$id", params: { id: data.id } });
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
        <DialogTitle>New lesson</DialogTitle>
        <DialogDescription>
          You can paste or upload the transcript on the next screen.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required maxLength={180} placeholder="e.g. Building your first workflow" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lesson_number">Lesson #</Label>
            <Input id="lesson_number" name="lesson_number" type="number" min={0} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lesson_date">Date</Label>
            <Input id="lesson_date" name="lesson_date" type="date" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="module_name">Module</Label>
          <Input id="module_name" name="module_name" maxLength={120} placeholder="Optional" />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create lesson"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

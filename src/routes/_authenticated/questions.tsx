import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-auth";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/questions")({
  head: () => ({ meta: [{ title: "Questions · Bootcamp Admin" }] }),
  component: QuestionsPage,
});

type SourceLesson = { lesson_id: string; lesson_title: string };
type QuestionRow = {
  id: string;
  bootcamp_id: string;
  student_id: string;
  question_text: string;
  ai_answer: string | null;
  confidence_score: number | null;
  retrieval_method: string | null;
  review_status: string | null;
  source_lessons: SourceLesson[] | null;
  created_at: string;
  students: {
    first_name: string | null;
    last_name: string | null;
    phone_number: string | null;
  } | null;
};

function confidenceTier(score: number | null): "high" | "medium" | "low" {
  const s = Number(score ?? 0);
  if (s >= 0.7) return "high";
  if (s >= 0.4) return "medium";
  return "low";
}

function ConfidenceBadge({ score }: { score: number | null }) {
  const tier = confidenceTier(score);
  const cls =
    tier === "high"
      ? "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200"
      : tier === "medium"
        ? "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200"
        : "bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200";
  return (
    <Badge variant="outline" className={cn("capitalize", cls)}>
      {tier} {score != null ? `(${Number(score).toFixed(2)})` : ""}
    </Badge>
  );
}

function truncate(s: string | null | undefined, n: number) {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function QuestionsPage() {
  const { data: perms } = usePermissions();
  const { data: bootcamps, isLoading: bcLoading } = useBootcamps();
  const queryClient = useQueryClient();

  const accessibleBootcamps = useMemo(() => {
    if (!bootcamps) return [];
    if (perms?.isPlatformAdmin) return bootcamps;
    const ids = new Set([
      ...(perms?.adminBootcampIds ?? []),
      ...(perms?.teacherBootcampIds ?? []),
    ]);
    return bootcamps.filter((b) => ids.has(b.id));
  }, [bootcamps, perms]);

  const [bootcampId, setBootcampId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "all">("30d");
  const [methodFilter, setMethodFilter] = useState<"all" | "answered" | "fallback">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [openId, setOpenId] = useState<string | null>(null);

  const accessibleIds = useMemo(() => accessibleBootcamps.map((b) => b.id), [accessibleBootcamps]);
  const scopedIds = bootcampId === "all" ? accessibleIds : [bootcampId];

  const { data: questions, isLoading } = useQuery({
    queryKey: ["questions", scopedIds, dateRange, methodFilter, confidenceFilter],
    enabled: scopedIds.length > 0,
    queryFn: async (): Promise<QuestionRow[]> => {
      let q = supabase
        .from("questions")
        .select(
          "id, bootcamp_id, student_id, question_text, ai_answer, confidence_score, retrieval_method, review_status, source_lessons, created_at, students(first_name, last_name, phone_number)",
        )
        .in("bootcamp_id", scopedIds)
        .order("created_at", { ascending: false })
        .limit(500);

      if (dateRange !== "all") {
        const days = dateRange === "7d" ? 7 : 30;
        const since = new Date(Date.now() - days * 86400_000).toISOString();
        q = q.gte("created_at", since);
      }
      if (methodFilter === "fallback") q = q.eq("retrieval_method", "fallback");
      else if (methodFilter === "answered") q = q.neq("retrieval_method", "fallback");

      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as unknown as QuestionRow[];
      if (confidenceFilter !== "all") {
        rows = rows.filter((r) => confidenceTier(r.confidence_score) === confidenceFilter);
      }
      return rows;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, needsReview }: { id: string; needsReview: boolean }) => {
      const { error } = await supabase
        .from("questions")
        .update({ review_status: needsReview ? "unreviewed" : "instructor_answered" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["questions"] }),
  });

  const open = questions?.find((q) => q.id === openId) ?? null;

  if (bcLoading) return <Skeleton className="h-72 w-full" />;
  if (!accessibleBootcamps.length) {
    return (
      <div>
        <PageHeader title="Questions" />
        <p className="text-sm text-muted-foreground">No bootcamps available.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Questions"
        description="Every question your students have asked, with the AI answer and source lessons."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={bootcampId} onValueChange={setBootcampId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bootcamps</SelectItem>
            {accessibleBootcamps.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as typeof methodFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="answered">Answered</SelectItem>
            <SelectItem value="fallback">Fallback</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={confidenceFilter}
          onValueChange={(v) => setConfidenceFilter(v as typeof confidenceFilter)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All confidence</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !questions || questions.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No questions match these filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead>AI Answer</TableHead>
                  <TableHead>Lesson source</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Needs review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((q) => {
                  const lessons = q.source_lessons ?? [];
                  const needsReview = q.review_status === "unreviewed" || q.review_status === "unresolved";
                  return (
                    <TableRow
                      key={q.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpenId(q.id)}
                    >
                      <TableCell className="text-sm">
                        {q.students
                          ? `${q.students.first_name ?? ""} ${q.students.last_name ?? ""}`.trim() ||
                            "—"
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-[260px] text-sm">
                        {truncate(q.question_text, 80)}
                      </TableCell>
                      <TableCell className="max-w-[260px] text-sm text-muted-foreground">
                        {truncate(q.ai_answer, 80)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {lessons.length === 0
                          ? "—"
                          : truncate(lessons.map((l) => l.lesson_title).join(", "), 40)}
                      </TableCell>
                      <TableCell>
                        <ConfidenceBadge score={q.confidence_score} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {q.retrieval_method ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(q.created_at)}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          checked={needsReview}
                          onCheckedChange={(checked) =>
                            reviewMutation.mutate({ id: q.id, needsReview: checked })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>Question detail</SheetTitle>
                <SheetDescription>
                  {open.students
                    ? `${open.students.first_name ?? ""} ${open.students.last_name ?? ""}`.trim()
                    : "Unknown student"}
                  {open.students?.phone_number ? ` · ${open.students.phone_number}` : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 text-sm">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Question
                  </div>
                  <p className="whitespace-pre-wrap">{open.question_text}</p>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    AI Answer
                  </div>
                  <p className="whitespace-pre-wrap">{open.ai_answer ?? "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <ConfidenceBadge score={open.confidence_score} />
                  <Badge variant="outline" className="capitalize">
                    {open.retrieval_method ?? "—"}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDate(open.created_at)}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Source lessons
                  </div>
                  {(open.source_lessons ?? []).length === 0 ? (
                    <p className="text-muted-foreground text-xs">No sources cited.</p>
                  ) : (
                    <ul className="list-disc pl-5 space-y-0.5">
                      {open.source_lessons!.map((l) => (
                        <li key={l.lesson_id}>{l.lesson_title}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center justify-between border-t pt-4">
                  <div>
                    <div className="text-sm font-medium">Mark needs review</div>
                    <div className="text-xs text-muted-foreground">
                      Flag for instructor follow-up.
                    </div>
                  </div>
                  <Switch
                    checked={
                      open.review_status === "unreviewed" || open.review_status === "unresolved"
                    }
                    onCheckedChange={(checked) =>
                      reviewMutation.mutate({ id: open.id, needsReview: checked })
                    }
                  />
                </div>
                <Button variant="outline" className="w-full" onClick={() => setOpenId(null)}>
                  Close
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

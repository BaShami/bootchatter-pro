import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-auth";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics · Bootcamp Admin" }] }),
  component: AnalyticsPage,
});

type AnalyticsRow = {
  id: string;
  bootcamp_id: string;
  question_text: string;
  confidence_score: number | null;
  retrieval_method: string | null;
  referenced_lessons: string[] | null;
  created_at: string;
  students: { first_name: string | null; last_name: string | null } | null;
};

function AnalyticsPage() {
  const { data: perms } = usePermissions();
  const { data: bootcamps, isLoading: bcLoading } = useBootcamps();

  const accessibleIds = useMemo(() => {
    if (!bootcamps) return [];
    if (perms?.isPlatformAdmin) return bootcamps.map((b) => b.id);
    const ids = new Set([
      ...(perms?.adminBootcampIds ?? []),
      ...(perms?.teacherBootcampIds ?? []),
    ]);
    return bootcamps.filter((b) => ids.has(b.id)).map((b) => b.id);
  }, [bootcamps, perms]);

  const since7 = useMemo(() => new Date(Date.now() - 7 * 86400_000).toISOString(), []);
  const since30 = useMemo(() => new Date(Date.now() - 30 * 86400_000).toISOString(), []);

  const weekly = useQuery({
    queryKey: ["analytics", "week", accessibleIds],
    enabled: accessibleIds.length > 0,
    queryFn: async (): Promise<AnalyticsRow[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, bootcamp_id, question_text, confidence_score, retrieval_method, referenced_lessons, created_at, students(first_name, last_name)",
        )
        .in("bootcamp_id", accessibleIds)
        .gte("created_at", since7)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as AnalyticsRow[];
    },
  });

  const monthly = useQuery({
    queryKey: ["analytics", "month", accessibleIds],
    enabled: accessibleIds.length > 0,
    queryFn: async (): Promise<AnalyticsRow[]> => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "id, bootcamp_id, question_text, confidence_score, retrieval_method, referenced_lessons, created_at, students(first_name, last_name)",
        )
        .in("bootcamp_id", accessibleIds)
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as AnalyticsRow[];
    },
  });

  // Lookup lessons to get titles
  const lessonIdsNeeded = useMemo(() => {
    const ids = new Set<string>();
    (monthly.data ?? []).forEach((q) =>
      (q.referenced_lessons ?? []).forEach((id) => ids.add(id)),
    );
    return Array.from(ids);
  }, [monthly.data]);

  const lessonTitles = useQuery({
    queryKey: ["analytics", "lesson-titles", lessonIdsNeeded],
    enabled: lessonIdsNeeded.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title")
        .in("id", lessonIdsNeeded);
      if (error) throw error;
      const m = new Map<string, string>();
      (data ?? []).forEach((l) => m.set(l.id as string, (l.title as string) ?? "Untitled"));
      return m;
    },
  });

  // ---- Stats ----
  const weekRows = weekly.data ?? [];
  const totalThisWeek = weekRows.length;
  const fallbackThisWeek = weekRows.filter((q) => q.retrieval_method === "fallback").length;
  const fallbackRate = totalThisWeek > 0 ? (fallbackThisWeek / totalThisWeek) * 100 : 0;
  const answered = weekRows.filter((q) => q.retrieval_method !== "fallback" && q.confidence_score != null);
  const avgConfidence =
    answered.length > 0
      ? answered.reduce((s, q) => s + Number(q.confidence_score ?? 0), 0) / answered.length
      : 0;

  // ---- Top lessons ----
  const topLessonsData = useMemo(() => {
    const counts = new Map<string, number>();
    (monthly.data ?? []).forEach((q) => {
      (q.referenced_lessons ?? []).forEach((id) => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([id, count]) => {
        const title = lessonTitles.data?.get(id) ?? "Lesson";
        return {
          id,
          title: title.length > 30 ? title.slice(0, 30) + "…" : title,
          count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [monthly.data, lessonTitles.data]);

  // ---- Fallback table ----
  const fallbackRows = (monthly.data ?? []).filter((q) => q.retrieval_method === "fallback");

  // ---- Questions over time (last 30d) ----
  const timeSeries = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, 0);
    }
    (monthly.data ?? []).forEach((q) => {
      const key = q.created_at.slice(0, 10);
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([date, count]) => ({
      date: date.slice(5),
      count,
    }));
  }, [monthly.data]);

  if (bcLoading) return <Skeleton className="h-72 w-full" />;
  if (!accessibleIds.length) {
    return (
      <div>
        <PageHeader title="Analytics" />
        <p className="text-sm text-muted-foreground">No bootcamps available.</p>
      </div>
    );
  }

  const loading = weekly.isLoading || monthly.isLoading;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="How students are using the AI and where content gaps are."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Questions this week"
          value={loading ? "…" : totalThisWeek.toString()}
        />
        <StatCard
          label="Fallback rate this week"
          value={loading ? "…" : `${fallbackRate.toFixed(1)}%`}
          hint={`${fallbackThisWeek} of ${totalThisWeek}`}
        />
        <StatCard
          label="Avg confidence this week"
          value={loading ? "…" : avgConfidence.toFixed(2)}
          hint="Excludes fallback answers"
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Top lessons by engagement</CardTitle>
        </CardHeader>
        <CardContent>
          {monthly.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : topLessonsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lesson references yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={topLessonsData}
                layout="vertical"
                margin={{ left: 120, right: 30, top: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  type="category"
                  dataKey="title"
                  width={110}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" barSize={20} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Questions the AI couldn't answer</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {monthly.isLoading ? (
            <div className="p-6">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : fallbackRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Great — the AI answered all recent questions from lesson content.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fallbackRows.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="text-sm">{q.question_text}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {q.students
                        ? `${q.students.first_name ?? ""} ${q.students.last_name ?? ""}`.trim() ||
                          "—"
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(q.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Questions over time</CardTitle>
        </CardHeader>
        <CardContent>
          {monthly.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeSeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

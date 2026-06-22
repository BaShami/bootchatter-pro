import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Users, BookOpen, MessageSquare, TrendingUp, AlertCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-auth";
import { TeacherDashboard } from "@/components/teacher-dashboard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Bootcamp Admin" }] }),
  component: DashboardRoute,
});

function DashboardRoute() {
  const { data: perms, isLoading } = usePermissions();
  if (isLoading) return null;
  if (perms?.isTeacher) return <TeacherDashboard />;
  return <Dashboard />;
}

function useStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        bootcamps,
        students,
        activeStudents,
        lessons,
        publishedLessons,
        questions,
        questionsToday,
        lowConf,
        unanswered,
        openEscalations,
      ] = await Promise.all([
        supabase.from("bootcamps").select("id", { count: "exact", head: true }),
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("enrollment_status", "active"),
        supabase.from("lessons").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("lessons").select("id", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
        supabase.from("questions").select("id", { count: "exact", head: true }),
        supabase.from("questions").select("id", { count: "exact", head: true }).gte("created_at", startOfToday.toISOString()),
        supabase.from("questions").select("id", { count: "exact", head: true }).lt("confidence_score", 0.5),
        supabase.from("questions").select("id", { count: "exact", head: true }).is("ai_answer", null),
        supabase.from("escalations").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      return {
        bootcamps: bootcamps.count ?? 0,
        students: students.count ?? 0,
        activeStudents: activeStudents.count ?? 0,
        lessons: lessons.count ?? 0,
        publishedLessons: publishedLessons.count ?? 0,
        questions: questions.count ?? 0,
        questionsToday: questionsToday.count ?? 0,
        lowConf: lowConf.count ?? 0,
        unanswered: unanswered.count ?? 0,
        openEscalations: openEscalations.count ?? 0,
      };
    },
  });
}

function useRecentActivity() {
  return useQuery({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      const [{ data: announcements }, { data: questions }, { data: logs }] = await Promise.all([
        supabase
          .from("announcements")
          .select("id, title, status, created_at")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("questions")
          .select("id, question_text, created_at, confidence_score, student_id, students(first_name, last_name)")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("activity_logs")
          .select("id, action, entity_type, created_at")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      return {
        announcements: announcements ?? [],
        questions: questions ?? [],
        logs: logs ?? [],
      };
    },
  });
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Users;
  loading?: boolean;
  accent?: "amber";
}) {
  const amber = accent === "amber";
  return (
    <Card className={amber ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className={cn("text-xs uppercase tracking-wider", amber ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{label}</div>
            {loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className={cn("text-2xl font-semibold tabular-nums", amber && "text-amber-900 dark:text-amber-200")}>{value}</div>
            )}
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
          </div>
          <div className={cn("h-9 w-9 rounded-md grid place-items-center", amber ? "bg-amber-200/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-accent text-accent-foreground")}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const stats = useStats();
  const activity = useRecentActivity();
  const s = stats.data;
  const loading = stats.isLoading;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="An overview of bootcamps, students, lessons, and student questions."
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bootcamps" value={s?.bootcamps ?? 0} icon={GraduationCap} loading={loading} />
        <StatCard
          label="Students"
          value={s?.students ?? 0}
          hint={`${s?.activeStudents ?? 0} active`}
          icon={Users}
          loading={loading}
        />
        <StatCard
          label="Lessons"
          value={s?.lessons ?? 0}
          hint={`${s?.publishedLessons ?? 0} published`}
          icon={BookOpen}
          loading={loading}
        />
        <StatCard
          label="Questions"
          value={s?.questions ?? 0}
          hint={`${s?.questionsToday ?? 0} today`}
          icon={MessageSquare}
          loading={loading}
        />
        <StatCard label="Low confidence" value={s?.lowConf ?? 0} icon={AlertCircle} loading={loading} />
        <StatCard label="Unanswered" value={s?.unanswered ?? 0} icon={AlertCircle} loading={loading} />
        <StatCard
          label="Active students"
          value={s?.activeStudents ?? 0}
          icon={TrendingUp}
          loading={loading}
        />
        <StatCard
          label="Published lessons"
          value={s?.publishedLessons ?? 0}
          icon={BookOpen}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3 mt-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Recent announcements</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? (
              <ListSkeleton />
            ) : activity.data?.announcements.length === 0 ? (
              <Empty>No announcements yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {activity.data?.announcements.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="font-medium truncate">{a.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.status} · {formatRelative(a.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Recent questions</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? (
              <ListSkeleton />
            ) : activity.data?.questions.length === 0 ? (
              <Empty>No questions yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {activity.data?.questions.map((q) => {
                  const student = (q as { students?: { first_name?: string; last_name?: string } | null }).students;
                  const studentName = student
                    ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
                    : null;
                  return (
                  <li key={q.id} className="text-sm">
                    {studentName && (q as { student_id?: string }).student_id ? (
                      <Link
                        to="/students"
                        search={{ highlight: (q as { student_id: string }).student_id }}
                        className="font-medium text-primary hover:underline block truncate"
                      >
                        {studentName}
                      </Link>
                    ) : null}
                    <div className="line-clamp-2">{q.question_text}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelative(q.created_at)}
                      {q.confidence_score != null ? ` · conf ${Number(q.confidence_score).toFixed(2)}` : ""}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? (
              <ListSkeleton />
            ) : activity.data?.logs.length === 0 ? (
              <Empty>No activity recorded yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {activity.data?.logs.map((l) => (
                  <li key={l.id} className="text-sm">
                    <div className="font-medium">{l.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.entity_type ?? "system"} · {formatRelative(l.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground py-2">{children}</div>;
}

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Users, Target, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getLessonQuizResults } from "@/lib/quiz-results.functions";

export function QuizResultsCard({ lessonId }: { lessonId: string }) {
  const fn = useServerFn(getLessonQuizResults);
  const { data, isLoading } = useQuery({
    queryKey: ["lesson-quiz-results", lessonId],
    queryFn: () => fn({ data: { lesson_id: lessonId } }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quiz results</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.attempted === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quiz results</CardTitle>
          <CardDescription>
            Student quiz attempts will appear here once they complete the quiz over SMS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No completed quizzes yet.</p>
        </CardContent>
      </Card>
    );
  }

  const total = data.questions.length;
  const avg = data.averageScore;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Quiz results</h2>
        <p className="text-sm text-muted-foreground">
          Based on {data.attempted} completed {data.attempted === 1 ? "attempt" : "attempts"}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Students attempted"
          value={String(data.attempted)}
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Average score"
          value={avg != null ? `${avg.toFixed(1)} / ${total}` : "—"}
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Struggling (< 2)"
          value={String(data.struggling)}
          tone={data.struggling > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-question breakdown</CardTitle>
          <CardDescription>How students performed on each question.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className="w-32">% correct</TableHead>
                <TableHead className="w-40">Correct answer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.questions.map((q, i) => {
                const pct = data.perQuestionCorrectPct[i] ?? 0;
                const tone =
                  pct >= 70
                    ? "bg-emerald-100 text-emerald-800"
                    : pct >= 40
                    ? "bg-amber-100 text-amber-800"
                    : "bg-destructive/10 text-destructive";
                const correctOption = q.options.find((o) =>
                  o.trim().toUpperCase().startsWith(q.correct.toUpperCase() + "."),
                );
                return (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">Q{i + 1}</TableCell>
                    <TableCell>{q.question}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={tone}>
                        {pct}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {correctOption ?? q.correct}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Student results</CardTitle>
          <CardDescription>Sorted by score, lowest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                {data.questions.map((_, i) => (
                  <TableHead key={i} className="w-16 text-center">
                    Q{i + 1}
                  </TableHead>
                ))}
                <TableHead className="w-20 text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.studentName}</TableCell>
                  {s.results.map((r, i) => (
                    <TableCell key={i} className="text-center">
                      {r === true ? "✅" : r === false ? "❌" : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">
                    {s.score}/{s.total}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.insight ? (
        <Card className="bg-muted/40">
          <CardContent className="py-4">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <p>{data.insight}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  const valueClass =
    tone === "warning" && value !== "0"
      ? "text-amber-700"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  testAskQuestion,
  runRetrievalTestSuite,
  backfillPublishedLessons,
  runFileSearchParserTest,
} from "@/lib/ai-test.functions";
import { CheckCircle2, XCircle, Database } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/lessons/test-brain")({
  head: () => ({ meta: [{ title: "Test AI brain · Bootcamp Admin" }] }),
  component: TestBrainPage,
});

const METHOD_COLOR: Record<string, string> = {
  full_text: "bg-blue-100 text-blue-800",
  file_search: "bg-purple-100 text-purple-800",
  combined: "bg-emerald-100 text-emerald-800",
  fallback: "bg-muted text-muted-foreground",
};

function TestBrainPage() {
  const [studentId, setStudentId] = useState("");
  const [question, setQuestion] = useState("");

  const students = useQuery({
    queryKey: ["test-brain-students"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, first_name, last_name, bootcamp_id, bootcamps(name)")
        .eq("enrollment_status", "active")
        .order("first_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const testFn = useServerFn(testAskQuestion);
  const ask = useMutation({
    mutationFn: () =>
      testFn({ data: { student_id: studentId, question } }),
  });

  const r = ask.data;

  return (
    <div>
      <PageHeader
        title="Test AI brain"
        description="Runs the same production retrieval (Supabase full-text + OpenAI File Search) without logging."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ask a question</CardTitle>
            <CardDescription>Pick a student to scope the request to their bootcamp.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Student</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger><SelectValue placeholder="Select a student…" /></SelectTrigger>
                <SelectContent>
                  {(students.data ?? []).map((s) => {
                    const bcName = (s.bootcamps as { name?: string } | null)?.name ?? s.bootcamp_id.slice(0, 6);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {s.first_name} {s.last_name} — {bcName}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q">Question</Label>
              <Textarea
                id="q"
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What was the main focus of this lesson?"
              />
            </div>
            <Button
              onClick={() => ask.mutate()}
              disabled={ask.isPending || !studentId || question.trim().length < 2}
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              Ask brain
            </Button>

            {ask.error ? (
              <p className="text-sm text-destructive">{(ask.error as Error).message}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!r ? (
              <p className="text-muted-foreground">No result yet.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span>Method</span>
                  <Badge variant="outline" className={METHOD_COLOR[r.retrieval_method]}>
                    {r.retrieval_method}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Confidence</span>
                  <span className="font-medium tabular-nums">{r.confidence.toFixed(2)}</span>
                </div>
                <div>
                  <div className="mb-1">Sources</div>
                  {r.source_lessons.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {r.retrieval_method === "fallback"
                        ? "fallback — no lessons matched"
                        : "none"}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {r.source_lessons.map((s) => (
                        <li key={s.lesson_id} className="text-xs">
                          • {s.lesson_title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {r ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Answer</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{r.answer}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Debug</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-[11px] leading-snug overflow-auto max-h-[480px] bg-muted/40 p-3 rounded">
                {JSON.stringify(r.debug ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <SuiteRunner />
    </div>
  );
}

function SuiteRunner() {
  const backfillFn = useServerFn(backfillPublishedLessons);
  const suiteFn = useServerFn(runRetrievalTestSuite);

  const backfill = useMutation({ mutationFn: () => backfillFn() });
  const suite = useMutation({ mutationFn: () => suiteFn() });

  return (
    <div className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Automated checks (platform admin)</h2>
        <p className="text-sm text-muted-foreground">
          Re-syncs every published lesson and runs the 6 canonical retrieval cases against the live brain.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
        >
          {backfill.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Database className="h-4 w-4 mr-1.5" />}
          Sync published lessons
        </Button>
        <Button onClick={() => suite.mutate()} disabled={suite.isPending}>
          {suite.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
          Run 6-case suite
        </Button>
      </div>

      {backfill.error ? (
        <p className="text-sm text-destructive">Backfill: {(backfill.error as Error).message}</p>
      ) : null}
      {backfill.data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Backfill results</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {backfill.data.results.map((r) => (
                <li key={r.lesson_id} className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={r.openai_status === "completed" || r.sync_status === "ready" ? "bg-emerald-100 text-emerald-800" : r.sync_status === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-800"}>
                    {r.openai_status ?? r.sync_status}
                  </Badge>
                  <span>{r.title}</span>
                  <span className="text-xs text-muted-foreground">({r.waited_ms} ms)</span>
                  {r.error ? <span className="text-xs text-destructive break-words">{r.error}</span> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {suite.error ? (
        <p className="text-sm text-destructive">Suite: {(suite.error as Error).message}</p>
      ) : null}
      {suite.data && "runs" in suite.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Suite results — {suite.data.passed}/{suite.data.total} passed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {suite.data.runs.map((r, i) => (
              <div key={i} className="border border-border rounded-md p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  {r.pass ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="font-medium text-sm">{r.name}</span>
                  <Badge variant="outline" className={METHOD_COLOR[r.method]}>{r.method}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">conf {r.confidence.toFixed(2)}</span>
                </div>
                {r.question ? <p className="text-xs text-muted-foreground italic">“{r.question}”</p> : null}
                <p className={`text-xs ${r.pass ? "text-muted-foreground" : "text-destructive"}`}>{r.reason}</p>
                {r.sources.length > 0 ? (
                  <p className="text-xs">Sources: {r.sources.map((s) => s.lesson_title).join(", ")}</p>
                ) : null}
                {r.answer_preview ? (
                  <p className="text-xs text-muted-foreground line-clamp-3">{r.answer_preview}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

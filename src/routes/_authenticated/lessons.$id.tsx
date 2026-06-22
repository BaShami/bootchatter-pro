import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Upload,
  Sparkles,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useLesson,
  useLessonFiles,
  useLessonChunkCount,
} from "@/hooks/use-lessons";
import { processLesson, setLessonPublished } from "@/lib/lessons.functions";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";
import { LessonSyncCard } from "@/components/lesson-sync-card";
import { LessonFilesCard } from "@/components/lesson-files-card";
import { QuizResultsCard } from "@/components/quiz-results-card";


export const Route = createFileRoute("/_authenticated/lessons/$id")({
  head: () => ({ meta: [{ title: "Lesson · Bootcamp Admin" }] }),
  component: LessonDetail,
});

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  ready: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  failed: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Not started",
  processing: "Processing...",
  ready: "Ready to publish",
  published: "Live",
  failed: "Upload failed — try again",
  archived: "Archived",
};

function LessonDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: lesson, isLoading } = useLesson(id);
  const { data: files } = useLessonFiles(id);
  const { data: chunkCount } = useLessonChunkCount(id);

  // local edit state
  const [title, setTitle] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [lessonNumber, setLessonNumber] = useState<string>("");
  const [lessonDate, setLessonDate] = useState("");
  const [description, setDescription] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [objectives, setObjectives] = useState("");
  const [topics, setTopics] = useState(""); // comma-separated
  const [generateMeta, setGenerateMeta] = useState(true);

  useEffect(() => {
    if (!lesson) return;
    setTitle(lesson.title ?? "");
    setModuleName(lesson.module_name ?? "");
    setLessonNumber(lesson.lesson_number != null ? String(lesson.lesson_number) : "");
    setLessonDate(lesson.lesson_date ?? "");
    setDescription(lesson.description ?? "");
    setTranscript(lesson.transcript ?? "");
    setSummary(lesson.summary ?? "");
    setObjectives(lesson.learning_objectives ?? "");
    setTopics((lesson.key_topics ?? []).join(", "));
  }, [lesson]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("lessons")
        .update({
          title,
          module_name: moduleName || null,
          lesson_number: lessonNumber ? Number(lessonNumber) : null,
          lesson_date: lessonDate || null,
          description: description || null,
          transcript: transcript || null,
          summary: summary || null,
          learning_objectives: objectives || null,
          key_topics: topics
            ? topics.split(",").map((t) => t.trim()).filter(Boolean)
            : [],
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lesson saved");
      qc.invalidateQueries({ queryKey: ["lesson", id] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processFn = useServerFn(processLesson);
  const publishFn = useServerFn(setLessonPublished);

  const process = useMutation({
    mutationFn: async () => {
      // Save transcript first if it changed
      await save.mutateAsync();
      return processFn({
        data: { lesson_id: id, generate_metadata: generateMeta },
      });
    },
    onSuccess: (res) => {
      toast.success(`Indexed ${res.chunk_count} chunks${generateMeta ? " + generated metadata" : ""}`);
      qc.invalidateQueries({ queryKey: ["lesson", id] });
      qc.invalidateQueries({ queryKey: ["lesson-chunk-count", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async (next: boolean) =>
      publishFn({ data: { lesson_id: id, publish: next } }),
    onSuccess: () => {
      toast.success("Lesson updated");
      qc.invalidateQueries({ queryKey: ["lesson", id] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lessons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lesson deleted");
      navigate({ to: "/lessons" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!lesson) {
    return (
      <div>
        <PageHeader title="Lesson not found" />
        <Button variant="outline" onClick={() => navigate({ to: "/lessons" })}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
      </div>
    );
  }

  const isPublished = lesson.status === "published";
  const hasChunks = (chunkCount ?? 0) > 0;

  return (
    <div>
      <Link
        to="/lessons"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> All lessons
      </Link>
      <PageHeader
        title={lesson.title}
        description={lesson.module_name ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={STATUS_STYLES[lesson.status]}>
              {STATUS_LABELS[lesson.status] ?? lesson.status}
            </Badge>
            {isPublished ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => publish.mutate(false)}
                disabled={publish.isPending}
              >
                <EyeOff className="h-4 w-4 mr-1.5" /> Unpublish
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => publish.mutate(true)}
                disabled={publish.isPending || !hasChunks}
                title={hasChunks ? "" : "Process the transcript first"}
              >
                <Eye className="h-4 w-4 mr-1.5" /> Publish
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lesson info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={180}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lesson_number">Lesson #</Label>
                  <Input
                    id="lesson_number"
                    type="number"
                    min={0}
                    value={lessonNumber}
                    onChange={(e) => setLessonNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lesson_date">Date</Label>
                  <Input
                    id="lesson_date"
                    type="date"
                    value={lessonDate}
                    onChange={(e) => setLessonDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="module_name">Module</Label>
                  <Input
                    id="module_name"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    maxLength={120}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Internal description</Label>
                <Textarea
                  id="description"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Transcript</CardTitle>
                <CardDescription>
                  Paste text or upload TXT, MD, DOCX, or PDF. The transcript is the source
                  of truth for the AI.
                </CardDescription>
              </div>
              <UploadButton lessonId={id} bootcampId={lesson.bootcamp_id} onParsed={(t) => {
                setTranscript((cur) => (cur ? cur + "\n\n" + t : t));
                toast.success("Transcript extracted");
              }} />
            </CardHeader>
            <CardContent>
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={18}
                placeholder="Paste the full lesson transcript here…"
                className="font-mono text-sm"
              />
              <div className="text-xs text-muted-foreground mt-2">
                {transcript.length.toLocaleString()} characters · {chunkCount ?? 0} chunks indexed
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Knowledge metadata</CardTitle>
              <CardDescription>
                Shown to instructors and used as extra context for the AI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="summary">Summary</Label>
                <Textarea
                  id="summary"
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={2000}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="objectives">Learning objectives</Label>
                <Textarea
                  id="objectives"
                  rows={4}
                  value={objectives}
                  onChange={(e) => setObjectives(e.target.value)}
                  placeholder="- Objective 1&#10;- Objective 2"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="topics">Key topics (comma-separated)</Label>
                <Input
                  id="topics"
                  value={topics}
                  onChange={(e) => setTopics(e.target.value)}
                  placeholder="e.g. webhooks, scenarios, error handling"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm("Delete this lesson permanently? Its chunks and files will also be removed."))
                  remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete lesson
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="h-4 w-4 mr-1.5" />
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI knowledge</CardTitle>
              <CardDescription>
                Embed the transcript so the AI can answer student questions from it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span>Chunks indexed</span>
                <span className="font-medium tabular-nums">{chunkCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Status</span>
                <Badge variant="outline" className={STATUS_STYLES[lesson.status]}>
                  {STATUS_LABELS[lesson.status] ?? lesson.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Published</span>
                <span className="text-muted-foreground">
                  {lesson.published_at ? formatDate(lesson.published_at) : "—"}
                </span>
              </div>

              <label className="flex items-start gap-2 text-sm pt-2 cursor-pointer">
                <Checkbox
                  checked={generateMeta}
                  onCheckedChange={(c) => setGenerateMeta(c === true)}
                />
                <span>
                  Also generate summary, objectives, and key topics with AI
                </span>
              </label>

              <Button
                className="w-full"
                onClick={() => process.mutate()}
                disabled={process.isPending || !transcript.trim()}
              >
                {process.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" /> Process transcript
                  </>
                )}
              </Button>

              {hasChunks ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready for AI question answering
                </div>
              ) : null}
            </CardContent>
          </Card>

          <LessonSyncCard lessonId={id} />

          <LessonFilesCard lessonId={id} />

        </div>
      </div>

      <div className="mt-8">
        <QuizResultsCard lessonId={id} />
      </div>
    </div>
  );
}

function UploadButton({
  lessonId,
  bootcampId,
  onParsed,
}: {
  lessonId: string;
  bootcampId: string;
  onParsed: (text: string) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
    setBusy(true);
    try {
      const { parseDocument } = await import("@/lib/parse-document");
      const parsed = await parseDocument(file);
      if (!parsed.text || parsed.text.length < 5) {
        throw new Error("No readable text found in this file");
      }

      // Upload original to storage (private bucket)
      const path = `${bootcampId}/${lessonId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("lesson-files").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;

      const { error: rowErr } = await supabase.from("lesson_files").insert({
        lesson_id: lessonId,
        bootcamp_id: bootcampId,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
      });
      if (rowErr) throw rowErr;

      qc.invalidateQueries({ queryKey: ["lesson-files", lessonId] });
      onParsed(parsed.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Reading…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-1.5" /> Upload file
          </>
        )}
      </Button>
    </>
  );
}

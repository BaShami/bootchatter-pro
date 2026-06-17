import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  resyncLessonToOpenAI,
  refreshLessonSyncStatus,
} from "@/lib/lessons.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const STATUS_COLOR: Record<string, string> = {
  not_synced: "bg-muted text-muted-foreground",
  uploading: "bg-primary/10 text-primary",
  indexing: "bg-amber-100 text-amber-800",
  ready: "bg-emerald-100 text-emerald-800",
  error: "bg-destructive/10 text-destructive",
};

export function LessonSyncCard({ lessonId }: { lessonId: string }) {
  const qc = useQueryClient();
  const resyncFn = useServerFn(resyncLessonToOpenAI);
  const refreshFn = useServerFn(refreshLessonSyncStatus);

  const { data: row } = useQuery({
    queryKey: ["lesson-sync", lessonId],
    refetchInterval: (q) => {
      const r = q.state.data as { openai_indexing_status?: string } | undefined;
      const s = r?.openai_indexing_status;
      return s === "uploading" || s === "indexing" ? 3000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select(
          "openai_indexing_status, openai_file_id, openai_indexed_at, last_synced_at, openai_sync_error",
        )
        .eq("id", lessonId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const resync = useMutation({
    mutationFn: () => resyncFn({ data: { lesson_id: lessonId, force: true } }),
    onSuccess: () => {
      toast.success("Sync started");
      qc.invalidateQueries({ queryKey: ["lesson-sync", lessonId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { lesson_id: lessonId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-sync", lessonId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-poll triggers refreshLessonSyncStatus while indexing
  useEffect(() => {
    const s = row?.openai_indexing_status;
    if (s === "uploading" || s === "indexing") {
      const id = setTimeout(() => refresh.mutate(), 3500);
      return () => clearTimeout(id);
    }
  }, [row?.openai_indexing_status, row?.openai_file_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = row?.openai_indexing_status ?? "not_synced";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI knowledge base sync</CardTitle>
        <CardDescription>
          Uploads the lesson to OpenAI File Search so the AI can answer semantic / rephrased questions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span>Status</span>
          <Badge variant="outline" className={STATUS_COLOR[status] ?? STATUS_COLOR.not_synced}>
            {status}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Indexed</span>
          <span className="text-muted-foreground">
            {row?.openai_indexed_at ? formatDate(row.openai_indexed_at) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Last sync</span>
          <span className="text-muted-foreground">
            {row?.last_synced_at ? formatDate(row.last_synced_at) : "—"}
          </span>
        </div>
        {row?.openai_sync_error ? (
          <p className="text-xs text-destructive break-words">{row.openai_sync_error}</p>
        ) : null}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => resync.mutate()}
            disabled={resync.isPending}
          >
            {resync.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4 mr-1.5" />
            )}
            Re-sync
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

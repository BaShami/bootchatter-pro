import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const VS_COLOR: Record<string, string> = {
  not_created: "bg-muted text-muted-foreground",
  ready: "bg-emerald-100 text-emerald-800",
  error: "bg-destructive/10 text-destructive",
};

export function BootcampKnowledgeBaseCard({ bootcampId }: { bootcampId: string }) {
  const settings = useQuery({
    queryKey: ["bootcamp-kb-settings", bootcampId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bootcamp_settings")
        .select("openai_vector_store_id, vector_store_status, ai_model")
        .eq("bootcamp_id", bootcampId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lessons = useQuery({
    queryKey: ["bootcamp-kb-lessons", bootcampId],
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, status, openai_indexing_status")
        .eq("bootcamp_id", bootcampId)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = (lessons.data ?? []).reduce(
    (acc, l) => {
      if (l.status === "published") acc.published += 1;
      const s = l.openai_indexing_status ?? "not_synced";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    { published: 0 } as Record<string, number>,
  );

  const vsStatus = settings.data?.vector_store_status ?? "not_created";
  const vsId = settings.data?.openai_vector_store_id ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI knowledge base</CardTitle>
        <CardDescription>OpenAI vector store status for this bootcamp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>Vector store</span>
              <Badge variant="outline" className={VS_COLOR[vsStatus] ?? VS_COLOR.not_created}>
                {vsStatus}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>ID</span>
              <span className="font-mono truncate max-w-[55%]">{vsId ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Model</span>
              <span className="text-muted-foreground">{settings.data?.ai_model ?? "gpt-4o-mini"}</span>
            </div>
            <div className="border-t border-border pt-3 space-y-1.5 text-sm">
              <Row label="Published lessons" value={totals.published ?? 0} />
              <Row label="Indexed (ready)" value={totals.ready ?? 0} />
              <Row label="Indexing" value={(totals.uploading ?? 0) + (totals.indexing ?? 0)} />
              <Row label="Errors" value={totals.error ?? 0} muted={totals.error ? false : true} />
              <Row label="Not synced" value={totals.not_synced ?? 0} muted />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}

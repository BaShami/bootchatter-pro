import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getBootcampWebhook,
  updateMakeWebhookUrl,
} from "@/lib/announcements.functions";

export function MakeWebhookCard({ bootcampId }: { bootcampId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getBootcampWebhook);
  const updateFn = useServerFn(updateMakeWebhookUrl);

  const q = useQuery({
    queryKey: ["bootcamp-webhook", bootcampId],
    queryFn: () => getFn({ data: { bootcamp_id: bootcampId } }),
  });

  const [url, setUrl] = useState("");
  useEffect(() => {
    if (q.data) setUrl(q.data.make_webhook_url ?? "");
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateFn({ data: { bootcamp_id: bootcampId, make_webhook_url: url.trim() } }),
    onSuccess: () => {
      toast.success("Webhook saved");
      qc.invalidateQueries({ queryKey: ["bootcamp-webhook", bootcampId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Announcements webhook</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Announcements POST one JSON payload per recipient to this Make webhook URL.
        </p>
        {q.isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="make-webhook">Make webhook URL</Label>
            <Input
              id="make-webhook"
              type="url"
              placeholder="https://hook.eu1.make.com/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            <Save className="h-4 w-4 mr-1.5" />
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

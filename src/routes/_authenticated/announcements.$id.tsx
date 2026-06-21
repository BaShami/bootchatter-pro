import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Send, CheckCircle2, XCircle, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAnnouncementDetail, sendAnnouncement } from "@/lib/announcements.functions";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/announcements/$id")({
  head: () => ({ meta: [{ title: "Announcement · Bootcamp Admin" }] }),
  component: AnnouncementDetailPage,
});

function AnnouncementDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailFn = useServerFn(getAnnouncementDetail);
  const sendFn = useServerFn(sendAnnouncement);

  const detail = useQuery({
    queryKey: ["announcement", id],
    queryFn: () => detailFn({ data: { id } }),
  });

  const send = useMutation({
    mutationFn: (opts?: { onlyFailed?: boolean }) =>
      sendFn({ data: { id, only_failed: opts?.onlyFailed ?? false } }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.delivered}${r.failed ? `, ${r.failed} failed` : ""}`);
      qc.invalidateQueries({ queryKey: ["announcement", id] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <Skeleton className="h-72 w-full" />;
  if (detail.isError) {
    return (
      <div>
        <PageHeader title="Could not load announcement" />
        <Button variant="outline" onClick={() => navigate({ to: "/announcements" })}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
      </div>
    );
  }
  const ann = detail.data!.announcement;
  const recipients = detail.data!.recipients;
  const delivered = recipients.filter((r) => r.processing_status === "sent").length;
  const failed = recipients.filter((r) => r.processing_status === "failed").length;
  const pending = recipients.filter((r) => r.processing_status === "pending").length;

  return (
    <div>
      <Link
        to="/announcements"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> All announcements
      </Link>
      <PageHeader
        title={ann.title}
        description={`Created ${formatDate(ann.created_at)}${ann.processed_at ? ` · sent ${formatDate(ann.processed_at)}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {failed > 0 && ann.status === "completed" ? (
              <Button
                variant="outline"
                onClick={() => send.mutate({ onlyFailed: true })}
                disabled={send.isPending}
              >
                Resend failed ({failed})
              </Button>
            ) : null}
            {ann.status !== "completed" ? (
              <Button onClick={() => send.mutate({ onlyFailed: false })} disabled={send.isPending}>
                <Send className="h-4 w-4 mr-1.5" />
                {send.isPending ? "Sending…" : "Send now"}
              </Button>
            ) : failed === 0 ? (
              <Badge>completed</Badge>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mb-6">
        <Metric label="Recipients" value={recipients.length} />
        <Metric label="Delivered" value={delivered} />
        <Metric label="Failed" value={failed} tone={failed ? "danger" : undefined} />
        <Metric label="Pending" value={pending} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Message</CardTitle></CardHeader>
          <CardContent>
            <div className="bg-[#dcf8c6] text-[#111] rounded-lg p-3 text-sm whitespace-pre-wrap shadow-sm">
              <div className="font-semibold mb-1">{ann.title}</div>
              {ann.message}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Recipients</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((r) => {
                  const s = (r as any).students;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {s ? `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() : r.student_id}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s?.phone_number ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusChip status={r.processing_status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div
          className={`text-xl font-semibold tabular-nums mt-1 ${tone === "danger" ? "text-destructive" : ""}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "sent")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> sent
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" /> failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5" /> pending
    </span>
  );
}

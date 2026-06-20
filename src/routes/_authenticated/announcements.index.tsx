import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-auth";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { listAnnouncements } from "@/lib/announcements.functions";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/announcements/")({
  head: () => ({ meta: [{ title: "Announcements · Bootcamp Admin" }] }),
  component: AnnouncementsListPage,
});

function AnnouncementsListPage() {
  const { data: perms } = usePermissions();
  const { data: bootcamps, isLoading: bcLoading } = useBootcamps();

  const accessibleIds = useMemo(() => {
    if (!bootcamps) return [];
    if (perms?.isPlatformAdmin) return bootcamps.map((b) => b.id);
    const ids = new Set([...(perms?.adminBootcampIds ?? []), ...(perms?.teacherBootcampIds ?? [])]);
    return bootcamps.filter((b) => ids.has(b.id)).map((b) => b.id);
  }, [bootcamps, perms]);

  const accessibleBootcamps = useMemo(
    () => (bootcamps ?? []).filter((b) => accessibleIds.includes(b.id)),
    [bootcamps, accessibleIds],
  );

  const [bootcampId, setBootcampId] = useState<string | undefined>(undefined);
  const activeId = bootcampId ?? accessibleBootcamps[0]?.id;

  const listFn = useServerFn(listAnnouncements);
  const announcements = useQuery({
    queryKey: ["announcements", activeId],
    enabled: !!activeId,
    queryFn: () => listFn({ data: { bootcamp_id: activeId! } }),
  });

  if (bcLoading) return <Skeleton className="h-72 w-full" />;
  if (!accessibleBootcamps.length) {
    return (
      <div>
        <PageHeader title="Announcements" />
        <p className="text-sm text-muted-foreground">No bootcamps available.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Send WhatsApp announcements to your students via Make."
        actions={
          activeId ? (
            <Button asChild>
              <Link to="/announcements/new" search={{ bootcamp_id: activeId }}>
                <Plus className="h-4 w-4 mr-1.5" /> New announcement
              </Link>
            </Button>
          ) : null
        }
      />

      {accessibleBootcamps.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Select value={activeId} onValueChange={(v) => setBootcampId(v)}>
            <SelectTrigger><SelectValue placeholder="Choose bootcamp" /></SelectTrigger>
            <SelectContent>
              {accessibleBootcamps.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {announcements.isLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : announcements.data?.announcements.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No announcements yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcements.data?.announcements.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link
                        to="/announcements/$id"
                        params={{ id: a.id }}
                        className="hover:underline"
                      >
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.audience_type === "all"
                        ? `All (${a.recipient_count})`
                        : `${a.recipient_count} student${a.recipient_count === 1 ? "" : "s"}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === "completed" ? "default" : "outline"}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.delivered_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.failed_count > 0 ? (
                        <span className="text-destructive">{a.failed_count}</span>
                      ) : (
                        a.failed_count
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.processed_at ? formatDate(a.processed_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Suppress unused import warning if formatDate becomes unused later
void supabase;

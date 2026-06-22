import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, RotateCcw } from "lucide-react";
import { usePermissions } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listDeletedLessons,
  restoreLesson,
  permanentlyDeleteLesson,
} from "@/lib/lessons.functions";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/recycle-bin")({
  head: () => ({ meta: [{ title: "Recycle bin · Bootcamp Admin" }] }),
  component: RecycleBinPage,
});

function RecycleBinPage() {
  const { data: perms, isLoading: permsLoading } = usePermissions();
  const qc = useQueryClient();
  const listFn = useServerFn(listDeletedLessons);
  const restoreFn = useServerFn(restoreLesson);
  const purgeFn = useServerFn(permanentlyDeleteLesson);

  const list = useQuery({
    queryKey: ["admin-deleted-lessons"],
    queryFn: () => listFn({}),
    enabled: !!perms?.isPlatformAdmin,
  });

  const [purgeId, setPurgeId] = useState<string | null>(null);
  const purgeTarget = list.data?.find((l) => l.id === purgeId) ?? null;

  const restore = useMutation({
    mutationFn: async (lessonId: string) => restoreFn({ data: { lesson_id: lessonId } }),
    onSuccess: () => {
      toast.success("Lesson restored");
      qc.invalidateQueries({ queryKey: ["admin-deleted-lessons"] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purge = useMutation({
    mutationFn: async (lessonId: string) => purgeFn({ data: { lesson_id: lessonId } }),
    onSuccess: () => {
      toast.success("Lesson permanently deleted");
      setPurgeId(null);
      qc.invalidateQueries({ queryKey: ["admin-deleted-lessons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (permsLoading) return <Skeleton className="h-72 w-full" />;
  if (!perms?.isPlatformAdmin) {
    return (
      <div>
        <PageHeader title="Recycle bin" />
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            This page is only available to platform administrators.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Recycle bin"
        description="Lessons that teachers have soft-deleted. Restore or permanently remove them."
        actions={<Badge variant="outline">{rows.length} deleted</Badge>}
      />

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="p-6">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              The recycle bin is empty.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lesson</TableHead>
                  <TableHead>Bootcamp</TableHead>
                  <TableHead>Deleted by</TableHead>
                  <TableHead>Deleted at</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>{r.bootcamp_name}</TableCell>
                    <TableCell>{r.deleted_by_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.deleted_at ? formatDate(r.deleted_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restore.mutate(r.id)}
                        disabled={restore.isPending}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPurgeId(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Permanently delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!purgeId} onOpenChange={(o) => !o && setPurgeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This cannot be undone. Delete forever?</DialogTitle>
            <DialogDescription>
              {purgeTarget
                ? `"${purgeTarget.title}" and all of its uploaded files, chunks, and storage data will be permanently removed.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurgeId(null)}
              disabled={purge.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => purgeId && purge.mutate(purgeId)}
              disabled={purge.isPending}
            >
              {purge.isPending ? "Deleting…" : "Delete forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

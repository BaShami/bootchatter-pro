import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, usePermissions } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/escalations")({
  head: () => ({ meta: [{ title: "Escalations · Bootcamp Admin" }] }),
  component: EscalationsPage,
});

type EscalationRow = {
  id: string;
  bootcamp_id: string;
  student_id: string;
  status: string;
  summary: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  students: {
    first_name: string | null;
    last_name: string | null;
    phone_number: string | null;
  } | null;
  bootcamps: { name: string | null } | null;
};

function useEscalations() {
  const { data: perms } = usePermissions();
  const ids = [...(perms?.adminBootcampIds ?? []), ...(perms?.teacherBootcampIds ?? [])];
  return useQuery({
    queryKey: ["escalations", perms?.isPlatformAdmin, ids.join(",")],
    enabled: !!perms,
    queryFn: async (): Promise<EscalationRow[]> => {
      let q = supabase
        .from("escalations")
        .select(
          "id, bootcamp_id, student_id, status, summary, created_at, resolved_at, resolved_by, students(first_name, last_name, phone_number), bootcamps(name)",
        )
        .order("created_at", { ascending: false });
      if (!perms?.isPlatformAdmin) {
        if (ids.length === 0) return [];
        q = q.in("bootcamp_id", ids);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EscalationRow[];
    },
  });
}

function EscalationsPage() {
  const { data, isLoading } = useEscalations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.find((e) => e.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Escalations"
        description="Conversations flagged for human review across your bootcamps."
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !data || data.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No escalations yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Bootcamp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => {
                  const name = `${e.students?.first_name ?? ""} ${e.students?.last_name ?? ""}`.trim() || "—";
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link
                          to="/students"
                          search={{ highlight: e.student_id }}
                          className="text-primary hover:underline"
                        >
                          {name}
                        </Link>
                      </TableCell>
                      <TableCell>{e.bootcamps?.name ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(e.created_at)}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(e.id)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="sm:max-w-lg">
          {selected ? <EscalationDetail escalation={selected} onClose={() => setSelectedId(null)} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent">
        Resolved
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 border-transparent">
      Open
    </Badge>
  );
}

function EscalationDetail({
  escalation,
  onClose,
}: {
  escalation: EscalationRow;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const name =
    `${escalation.students?.first_name ?? ""} ${escalation.students?.last_name ?? ""}`.trim() || "—";

  const { data: resolver } = useQuery({
    queryKey: ["profile", escalation.resolved_by],
    enabled: !!escalation.resolved_by,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", escalation.resolved_by!)
        .maybeSingle();
      return data;
    },
  });

  const resolve = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("escalations")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq("id", escalation.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Escalation marked as resolved");
      qc.invalidateQueries({ queryKey: ["escalations"] });
      qc.invalidateQueries({ queryKey: ["open-escalations-count"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle>{name}</SheetTitle>
        <SheetDescription>
          {escalation.bootcamps?.name ?? "—"}
          {escalation.students?.phone_number ? ` · ${escalation.students.phone_number}` : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={escalation.status} />
          <span className="text-xs text-muted-foreground">
            Created {formatRelative(escalation.created_at)}
          </span>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Conversation summary
          </div>
          <Card className="bg-muted/40 shadow-none">
            <CardContent className="p-4 text-sm whitespace-pre-wrap">
              {escalation.summary?.trim() || (
                <span className="text-muted-foreground">No summary available.</span>
              )}
            </CardContent>
          </Card>
        </div>

        {escalation.status === "resolved" ? (
          <div className="text-sm text-muted-foreground">
            Resolved {formatRelative(escalation.resolved_at)}
            {resolver
              ? ` by ${`${resolver.first_name ?? ""} ${resolver.last_name ?? ""}`.trim() || resolver.email}`
              : ""}
          </div>
        ) : (
          <Button onClick={() => resolve.mutate()} disabled={resolve.isPending}>
            {resolve.isPending ? "Resolving…" : "Mark as resolved"}
          </Button>
        )}
      </div>
    </>
  );
}

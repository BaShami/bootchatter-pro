import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { usePermissions } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  actionPasswordResetRequest,
  listPasswordResetRequests,
} from "@/lib/password-reset.functions";

export const Route = createFileRoute("/_authenticated/admin/password-requests")({
  head: () => ({ meta: [{ title: "Password requests · Bootcamp Admin" }] }),
  component: PasswordRequestsPage,
});

function PasswordRequestsPage() {
  const { data: perms, isLoading: permsLoading } = usePermissions();
  const list = useServerFn(listPasswordResetRequests);
  const requests = useQuery({
    queryKey: ["password-reset-requests"],
    queryFn: () => list({}),
    enabled: !!perms?.isPlatformAdmin,
  });

  if (permsLoading) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (!perms?.isPlatformAdmin) {
    return (
      <div>
        <PageHeader title="Not authorized" />
        <p className="text-sm text-muted-foreground">
          You need to be a platform admin to view this page.
        </p>
      </div>
    );
  }

  const rows = requests.data?.requests ?? [];

  return (
    <div>
      <PageHeader
        title="Password reset requests"
        description="Generate a temporary password for users who can't sign in. The password is shown once — copy and send it securely."
      />
      <Card>
        <CardContent className="p-0">
          {requests.isLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <RequestRow key={r.id} request={r} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type RequestRow = {
  id: string;
  email: string;
  user_id: string | null;
  requested_at: string;
  actioned_at: string | null;
  status: string;
};

function RequestRow({ request }: { request: RequestRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const action = useServerFn(actionPasswordResetRequest);

  const mutation = useMutation({
    mutationFn: () => action({ data: { request_id: request.id } }),
    onSuccess: (res) => {
      setTempPassword(res.temp_password);
      qc.invalidateQueries({ queryKey: ["password-reset-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{request.email}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(request.requested_at).toLocaleString()}
        </TableCell>
        <TableCell>
          <Badge variant={request.status === "pending" ? "default" : "outline"}>
            {request.status}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          {request.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(true);
                setTempPassword(null);
              }}
            >
              <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Set temp password
            </Button>
          )}
        </TableCell>
      </TableRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password for {request.email}</DialogTitle>
            <DialogDescription>
              A strong password is generated and applied to the user's account. Copy it now — it
              cannot be retrieved later.
            </DialogDescription>
          </DialogHeader>

          {tempPassword ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={tempPassword} className="font-mono" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPassword);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tell the user to sign in with this password and change it from their profile.
              </p>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Generating…" : "Generate password"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

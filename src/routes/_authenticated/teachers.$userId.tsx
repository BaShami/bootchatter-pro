import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { getTeacherProfile } from "@/lib/teachers.functions";
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
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/teachers/$userId")({
  head: () => ({ meta: [{ title: "Teacher profile · Bootcamp Admin" }] }),
  component: TeacherProfilePage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Not started",
  processing: "Processing...",
  ready: "Ready to publish",
  published: "Live",
  failed: "Upload failed — try again",
  archived: "Archived",
};

function TeacherProfilePage() {
  const { userId } = Route.useParams();
  const profileFn = useServerFn(getTeacherProfile);
  const profile = useQuery({
    queryKey: ["teacher-profile", userId],
    queryFn: () => profileFn({ data: { user_id: userId } }),
  });

  if (profile.isLoading) return <Skeleton className="h-72 w-full" />;
  if (profile.isError || !profile.data) {
    return (
      <div>
        <PageHeader title="Could not load profile" />
        <Button variant="outline" asChild>
          <Link to="/announcements"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Link>
        </Button>
      </div>
    );
  }

  const { profile: p, bootcamps, roles, announcements, lessons } = profile.data;
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "User";

  return (
    <div>
      <Link
        to="/announcements"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Announcements
      </Link>
      <PageHeader
        title={name}
        description={p.email ?? undefined}
        actions={
          <div className="flex gap-1">
            {roles.map((r) => (
              <Badge key={r} variant="outline">{r}</Badge>
            ))}
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Bootcamps</CardTitle></CardHeader>
        <CardContent>
          {bootcamps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bootcamp memberships.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {bootcamps.map((b) => (
                <li key={b.id} className="flex items-center justify-between">
                  <Link to="/bootcamps/$id" params={{ id: b.id }} className="hover:underline">
                    {b.name}
                  </Link>
                  <span className="text-muted-foreground capitalize">{b.role} · {b.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Announcements sent</CardTitle></CardHeader>
          <CardContent className="p-0">
            {announcements.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No announcements yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {announcements.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        <Link to="/announcements/$id" params={{ id: a.id }} className="hover:underline">
                          {a.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(a.created_at)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{a.delivered_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Lessons uploaded</CardTitle></CardHeader>
          <CardContent className="p-0">
            {lessons.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No lessons uploaded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lessons.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        <Link to="/lessons/$id" params={{ id: l.id }} className="hover:underline">
                          {l.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(l.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {STATUS_LABELS[l.status] ?? l.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

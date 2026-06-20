import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Users, Megaphone, Upload, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";

export function TeacherDashboard() {
  const user = useCurrentUser();
  const { data: bootcamps, isLoading } = useBootcamps();

  const firstName = user?.user_metadata?.first_name as string | undefined;
  const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
  const isNewTeacher = createdAt > Date.now() - 24 * 60 * 60 * 1000;

  return (
    <div>
      <PageHeader
        title="My Bootcamps"
        description="Upload lesson transcripts and send announcements to your students."
      />

      {isNewTeacher && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="p-5 flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-primary text-primary-foreground grid place-items-center shrink-0">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-medium">
                Welcome{firstName ? `, ${firstName}` : ""}.
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                You can upload lesson transcripts and send announcements to your students.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !bootcamps?.length ? (
        <Card>
          <CardContent className="p-10 text-center">
            <h3 className="font-medium">No bootcamps assigned yet</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Ask your admin to assign you to a bootcamp.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {bootcamps.map((b) => (
            <TeacherBootcampCard key={b.id} id={b.id} name={b.name} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherBootcampCard({ id, name }: { id: string; name: string }) {
  const stats = useQuery({
    queryKey: ["teacher-bootcamp-stats", id],
    queryFn: async () => {
      const [lessons, students, announcement] = await Promise.all([
        supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .eq("bootcamp_id", id)
          .eq("status", "published"),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("bootcamp_id", id)
          .eq("enrollment_status", "active"),
        supabase
          .from("announcements")
          .select("created_at")
          .eq("bootcamp_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        publishedLessons: lessons.count ?? 0,
        students: students.count ?? 0,
        lastAnnouncement: announcement.data?.created_at ?? null,
      };
    },
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <Link
            to="/bootcamps/$id"
            params={{ id }}
            className="font-semibold leading-tight hover:underline"
          >
            {name}
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat icon={BookOpen} label="Lessons" value={stats.data?.publishedLessons ?? "—"} />
          <Stat icon={Users} label="Students" value={stats.data?.students ?? "—"} />
          <Stat
            icon={Megaphone}
            label="Last update"
            value={
              stats.data?.lastAnnouncement
                ? formatRelative(stats.data.lastAnnouncement)
                : "None"
            }
          />
        </div>
        <div className="flex gap-2 pt-1">
          <Button asChild size="sm" className="flex-1">
            <Link to="/lessons">
              <Upload className="h-4 w-4 mr-1.5" /> Upload Lesson
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="flex-1">
            <Link to="/bootcamps/$id" params={{ id }}>
              <Megaphone className="h-4 w-4 mr-1.5" /> Send Announcement
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="font-medium mt-1 truncate">{value}</div>
    </div>
  );
}

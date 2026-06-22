import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ItemProps = {
  done: boolean;
  label: string;
  to: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
};

function ChecklistItem({ done, label, to, search, params }: ItemProps) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <Icon className={cn("h-4 w-4 shrink-0", done ? "text-emerald-600" : "text-muted-foreground")} />
      <Link
        to={to}
        params={params as never}
        search={search as never}
        className={cn(
          "hover:underline",
          done ? "text-muted-foreground line-through" : "text-foreground font-medium",
        )}
      >
        {label}
      </Link>
    </li>
  );
}

export function BootcampOnboardingChecklist({ bootcampId }: { bootcampId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["bootcamp-onboarding", bootcampId],
    queryFn: async () => {
      const [students, publishedLessons, settings, announcements] = await Promise.all([
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("bootcamp_id", bootcampId),
        supabase
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .eq("bootcamp_id", bootcampId)
          .eq("status", "published")
          .is("deleted_at", null),
        supabase
          .from("bootcamp_settings")
          .select("make_webhook_url, student_onboarding_webhook_url")
          .eq("bootcamp_id", bootcampId)
          .maybeSingle(),
        supabase
          .from("announcements")
          .select("id", { count: "exact", head: true })
          .eq("bootcamp_id", bootcampId),
      ]);
      return {
        hasStudent: (students.count ?? 0) > 0,
        hasPublishedLesson: (publishedLessons.count ?? 0) > 0,
        hasWebhook: !!settings.data?.make_webhook_url?.trim(),
        hasStudentOnboardingWebhook: !!settings.data?.student_onboarding_webhook_url?.trim(),
        hasAnnouncement: (announcements.count ?? 0) > 0,
      };
    },
  });

  if (isLoading) return <Skeleton className="h-44 w-full" />;
  if (!data) return null;

  const allDone =
    data.hasStudent &&
    data.hasPublishedLesson &&
    data.hasWebhook &&
    data.hasStudentOnboardingWebhook &&
    data.hasAnnouncement;
  // Hide checklist only once the bootcamp has students AND a published lesson (per spec).
  if (data.hasStudent && data.hasPublishedLesson && allDone) return null;
  if (data.hasStudent && data.hasPublishedLesson) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Get this bootcamp ready</CardTitle>
        <CardDescription>Finish these steps to start serving students.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          <ChecklistItem done={data.hasStudent} label="Add at least one student" to="/students" />
          <ChecklistItem
            done={data.hasPublishedLesson}
            label="Upload and publish a lesson"
            to="/lessons"
          />
          <ChecklistItem
            done={data.hasWebhook}
            label="Configure Make webhook URL"
            to="/bootcamps/$id"
            params={{ id: bootcampId }}
          />
          <ChecklistItem
            done={data.hasStudentOnboardingWebhook}
            label="Configure student onboarding webhook URL"
            to="/bootcamps/$id"
            params={{ id: bootcampId }}
          />
          <ChecklistItem
            done={data.hasAnnouncement}
            label="Send your first announcement"
            to="/announcements/new"
            search={{ bootcamp_id: bootcampId }}
          />
        </ul>
      </CardContent>
    </Card>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Send, Save, Search } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-auth";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createAnnouncement, sendAnnouncement } from "@/lib/announcements.functions";

const searchSchema = z.object({
  bootcamp_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/announcements/new")({
  head: () => ({ meta: [{ title: "New announcement · Bootcamp Admin" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: NewAnnouncementPage,
});

const WHATSAPP_LIMIT = 1000;

function NewAnnouncementPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { bootcamp_id: initialBootcampId } = Route.useSearch();
  const { data: perms } = usePermissions();
  const { data: bootcamps } = useBootcamps();

  const accessible = useMemo(() => {
    if (!bootcamps) return [];
    if (perms?.isPlatformAdmin) return bootcamps;
    const ids = new Set([...(perms?.adminBootcampIds ?? []), ...(perms?.teacherBootcampIds ?? [])]);
    return bootcamps.filter((b) => ids.has(b.id));
  }, [bootcamps, perms]);

  const [bootcampId, setBootcampId] = useState<string | undefined>(initialBootcampId);
  const activeId = bootcampId ?? accessible[0]?.id;
  const activeBootcamp = accessible.find((b) => b.id === activeId);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audienceType, setAudienceType] = useState<"all" | "specific">("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const students = useQuery({
    queryKey: ["students-for-announcement", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, first_name, last_name, email, phone_number, enrollment_status, consent_status")
        .eq("bootcamp_id", activeId!)
        .order("first_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const eligibleStudents = useMemo(
    () =>
      (students.data ?? []).filter(
        (s) => s.enrollment_status === "active" && s.consent_status === "granted",
      ),
    [students.data],
  );

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleStudents;
    return eligibleStudents.filter((s) =>
      `${s.first_name ?? ""} ${s.last_name ?? ""} ${s.email ?? ""}`.toLowerCase().includes(q),
    );
  }, [eligibleStudents, search]);

  const recipientCount =
    audienceType === "all" ? eligibleStudents.length : selectedStudentIds.length;

  const createFn = useServerFn(createAnnouncement);
  const sendFn = useServerFn(sendAnnouncement);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("Pick a bootcamp");
      const created = await createFn({
        data: {
          bootcamp_id: activeId,
          title,
          message,
          audience_type: audienceType,
          student_ids: audienceType === "specific" ? selectedStudentIds : null,
        },
      });
      const sent = await sendFn({ data: { id: created.id } });
      return { id: created.id, ...sent };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast.success(`Sent to ${res.delivered} students${res.failed ? `, ${res.failed} failed` : ""}`);
      navigate({ to: "/announcements/$id", params: { id: res.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("Pick a bootcamp");
      return createFn({
        data: {
          bootcamp_id: activeId,
          title,
          message,
          audience_type: audienceType,
          student_ids: audienceType === "specific" ? selectedStudentIds : null,
          save_as_draft: true,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Draft saved");
      navigate({ to: "/announcements" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function validate(): string | null {
    if (!activeId) return "Pick a bootcamp";
    if (!title.trim()) return "Title is required";
    if (!message.trim()) return "Message is required";
    if (audienceType === "specific" && selectedStudentIds.length === 0)
      return "Pick at least one student";
    return null;
  }

  const tooLong = message.length > WHATSAPP_LIMIT;
  const charCountColor =
    message.length > WHATSAPP_LIMIT
      ? "text-destructive"
      : message.length > WHATSAPP_LIMIT * 0.9
        ? "text-amber-600"
        : "text-muted-foreground";

  return (
    <div className="max-w-5xl">
      <nav aria-label="breadcrumb" className="mb-3">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link to="/dashboard" className="hover:text-foreground">Home</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to="/announcements" className="hover:text-foreground inline-flex items-center">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Announcements
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground font-medium">New</li>
        </ol>
      </nav>
      <PageHeader
        title="New announcement"
        description="Compose a WhatsApp announcement and send it via your Make webhook."
      />


      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          {accessible.length > 1 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Bootcamp</CardTitle></CardHeader>
              <CardContent>
                <Select value={activeId} onValueChange={setBootcampId}>
                  <SelectTrigger><SelectValue placeholder="Choose bootcamp" /></SelectTrigger>
                  <SelectContent>
                    {accessible.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Message</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Lesson 3 is now live"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message">Message</Label>
                  <span className={`text-xs tabular-nums ${charCountColor}`}>
                    {message.length} / {WHATSAPP_LIMIT}
                  </span>
                </div>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={8}
                  placeholder="Hi {first_name}, the new lesson is up. Open the portal to start."
                />
                {tooLong && (
                  <p className="text-xs text-destructive">
                    Over the WhatsApp 1000-character limit. Shorten before sending.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Audience</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="inline-flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setAudienceType("all")}
                  className={`px-3 py-1.5 text-sm rounded ${
                    audienceType === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  All students ({eligibleStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAudienceType("specific")}
                  className={`px-3 py-1.5 text-sm rounded ${
                    audienceType === "specific" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  Select students
                </button>
              </div>

              {audienceType === "all" ? (
                <p className="text-xs text-muted-foreground">
                  Sends to all active students with granted consent.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search students…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{selectedStudentIds.length} selected</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => setSelectedStudentIds(filteredStudents.map((s) => s.id))}
                      >
                        Select all{search ? " filtered" : ""}
                      </button>
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => setSelectedStudentIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="border border-border rounded-md max-h-72 overflow-y-auto divide-y divide-border">
                    {students.isLoading ? (
                      <Skeleton className="h-32 w-full" />
                    ) : filteredStudents.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No matching students.</p>
                    ) : (
                      filteredStudents.map((s) => {
                        const checked = selectedStudentIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                setSelectedStudentIds((prev) =>
                                  v ? [...new Set([...prev, s.id])] : prev.filter((x) => x !== s.id),
                                )
                              }
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {s.first_name} {s.last_name}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {s.phone_number ?? s.email}
                              </div>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">WhatsApp preview</CardTitle></CardHeader>
            <CardContent>
              <div className="bg-[#dcf8c6] text-[#111] rounded-lg p-3 text-sm whitespace-pre-wrap shadow-sm">
                {title && <div className="font-semibold mb-1">{title}</div>}
                {message || (
                  <span className="text-muted-foreground italic">Your message will appear here…</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Sent via {activeBootcamp?.name ?? "your bootcamp"}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Send</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Recipients: </span>
                <span className="font-medium tabular-nums">{recipientCount}</span>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  const err = validate();
                  if (err) return toast.error(err);
                  if (tooLong) return toast.error("Message is over the character limit");
                  setConfirmOpen(true);
                }}
                disabled={sendMutation.isPending}
              >
                <Send className="h-4 w-4 mr-1.5" />
                {sendMutation.isPending ? "Sending…" : "Send now"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const err = validate();
                  if (err) return toast.error(err);
                  draftMutation.mutate();
                }}
                disabled={draftMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1.5" />
                {draftMutation.isPending ? "Saving…" : "Save as draft"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send to {recipientCount} student{recipientCount === 1 ? "" : "s"} via
              WhatsApp. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => sendMutation.mutate()}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

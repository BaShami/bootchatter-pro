import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Search, MoreHorizontal, Upload, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBootcamps } from "@/hooks/use-bootcamps";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatRelative } from "@/lib/format";
import { csvFilename, downloadCsv, parseCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  highlight: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({ meta: [{ title: "Students · Bootcamp Admin" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: StudentsPage,
});

const E164 = /^\+[1-9]\d{6,14}$/;
const addSchema = z.object({
  bootcamp_id: z.string().uuid("Pick a bootcamp"),
  first_name: z.string().trim().min(1, "First name required").max(80),
  last_name: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone_number: z.string().trim().regex(E164, "Use E.164 format e.g. +27820000000").max(20),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  consent_status: z.enum(["pending", "granted", "revoked"]),
});

const editSchema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  last_name: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone_number: z.string().trim().regex(E164, "Use E.164 format e.g. +27820000000").max(20),
  enrollment_status: z.enum(["invited", "active", "suspended", "completed", "removed"]),
  consent_status: z.enum(["pending", "granted", "revoked"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

type Student = {
  id: string;
  bootcamp_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone_number: string;
  enrollment_status: "invited" | "active" | "suspended" | "completed" | "removed";
  consent_status: "pending" | "granted" | "revoked";
  enrolled_at: string | null;
  last_active_at: string | null;
  created_at: string;
  notes: string | null;
};

const STATUS_STYLES: Record<Student["enrollment_status"], string> = {
  invited: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  suspended: "bg-warning/15 text-warning-foreground",
  completed: "bg-success/15 text-success",
  removed: "bg-destructive/10 text-destructive",
};

function StudentsPage() {
  const { highlight } = Route.useSearch();
  const { data: bootcamps } = useBootcamps();
  const [bootcampFilter, setBootcampFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const qc = useQueryClient();

  const students = useQuery({
    queryKey: ["students"],
    queryFn: async (): Promise<Student[]> => {
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Student[];
    },
  });

  const bootcampLookup = useMemo(
    () => Object.fromEntries((bootcamps ?? []).map((b) => [b.id, b.name])),
    [bootcamps],
  );

  const filtered = (students.data ?? []).filter((s) => {
    if (bootcampFilter !== "all" && s.bootcamp_id !== bootcampFilter) return false;
    if (statusFilter !== "all" && s.enrollment_status !== statusFilter) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      s.first_name.toLowerCase().includes(needle) ||
      (s.last_name ?? "").toLowerCase().includes(needle) ||
      (s.email ?? "").toLowerCase().includes(needle) ||
      s.phone_number.includes(needle)
    );
  });

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.includes(s.id));

  useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current[highlight];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/15");
      const t = setTimeout(() => el.classList.remove("bg-primary/15"), 2500);
      return () => clearTimeout(t);
    }
  }, [highlight, filtered]);

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("students").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Deleted ${count} student${count === 1 ? "" : "s"}`);
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkStatus = useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: Student["enrollment_status"];
    }) => {
      const { error } = await supabase
        .from("students")
        .update({ enrollment_status: status })
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Updated ${count} student${count === 1 ? "" : "s"}`);
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function exportStudents() {
    const rows = filtered.map((s) => [
      s.first_name,
      s.last_name ?? "",
      s.phone_number,
      s.email ?? "",
      s.enrollment_status,
      s.consent_status,
      s.enrolled_at ?? "",
      s.last_active_at ?? "",
      bootcampLookup[s.bootcamp_id] ?? "",
    ]);
    const header = [
      "first_name",
      "last_name",
      "phone_number",
      "email",
      "enrollment_status",
      "consent_status",
      "enrolled_at",
      "last_active_at",
      "bootcamp_name",
    ];
    const bootcampName =
      bootcampFilter !== "all" ? bootcampLookup[bootcampFilter] ?? "bootcamp" : "all";
    downloadCsv(csvFilename("students", bootcampName), toCsv([header, ...rows]));
  }

  const selectedStudents = filtered.filter((s) => selectedIds.includes(s.id));
  const bulkBootcampId = selectedStudents[0]?.bootcamp_id;

  return (
    <div>
      <PageHeader
        title="Students"
        description="Students interact through WhatsApp via Make.com. Phone numbers identify them — store them in international (E.164) format."
        actions={
          (bootcamps ?? []).length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportStudents}>
                <Download className="h-4 w-4 mr-1.5" /> Export
              </Button>
              <ImportCsvDialog bootcamps={bootcamps ?? []} defaultBootcampId={bootcampFilter !== "all" ? bootcampFilter : bootcamps![0].id} />
              <AddStudentDialog bootcamps={bootcamps ?? []} />
            </div>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="pl-9"
          />
        </div>
        <Select value={bootcampFilter} onValueChange={setBootcampFilter}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Bootcamp" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bootcamps</SelectItem>
            {(bootcamps ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="removed">Removed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-muted/40">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Select
            onValueChange={(v) =>
              bulkStatus.mutate({
                ids: selectedIds,
                status: v as Student["enrollment_status"],
              })
            }
          >
            <SelectTrigger className="w-44 h-8">
              <SelectValue placeholder="Change status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkDelete.isPending}
            onClick={() => {
              if (confirm(`Delete ${selectedIds.length} students? This cannot be undone.`)) {
                bulkDelete.mutate(selectedIds);
              }
            }}
          >
            Delete selected
          </Button>
          {bulkBootcampId && (
            <Button size="sm" variant="outline" asChild>
              <Link
                to="/announcements/new"
                search={{
                  bootcamp_id: bulkBootcampId,
                  student_ids: selectedIds.join(","),
                }}
              >
                Send announcement
              </Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Clear</Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {students.isLoading ? (
            <div className="p-6"><Skeleton className="h-40 w-full" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <h3 className="font-medium">No students added yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {(bootcamps ?? []).length === 0
                  ? "Create a bootcamp first, then add students to it."
                  : "Add students with their WhatsApp number to get started."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedIds(filtered.map((s) => s.id));
                          else setSelectedIds([]);
                        }}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Bootcamp</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow
                      key={s.id}
                      ref={(el) => {
                        rowRefs.current[s.id] = el;
                      }}
                      data-student-id={s.id}
                      className={cn(highlight === s.id && "bg-primary/15")}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(s.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds((prev) =>
                              checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                            );
                          }}
                          aria-label={`Select ${s.first_name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{s.first_name} {s.last_name ?? ""}</div>
                        {s.email ? <div className="text-xs text-muted-foreground">{s.email}</div> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">{s.phone_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{bootcampLookup[s.bootcamp_id] ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLES[s.enrollment_status]}>
                          {s.enrollment_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(s.enrolled_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.last_active_at ? formatRelative(s.last_active_at) : "Never messaged"}
                      </TableCell>
                      <TableCell>
                        <StudentActions student={s} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StudentActions({ student }: { student: Student }) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const update = useMutation({
    mutationFn: async (status: Student["enrollment_status"]) => {
      const { error } = await supabase
        .from("students")
        .update({ enrollment_status: status })
        .eq("id", student.id);
      if (error) throw error;
    },
    onSuccess: (_d, status) => {
      toast.success(`Student marked as ${status}`);
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("students").delete().eq("id", student.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Student removed");
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit student</DropdownMenuItem>
          <DropdownMenuItem onClick={() => update.mutate("active")}>Mark active</DropdownMenuItem>
        <DropdownMenuItem onClick={() => update.mutate("suspended")}>Suspend</DropdownMenuItem>
        <DropdownMenuItem onClick={() => update.mutate("completed")}>Mark completed</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (confirm(`Permanently delete ${student.first_name}? This cannot be undone.`)) {
              remove.mutate();
            }
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <EditStudentDialog student={student} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}

function EditStudentDialog({
  student,
  open,
  onOpenChange,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: z.infer<typeof editSchema>) => {
      const { error } = await supabase
        .from("students")
        .update({
          first_name: input.first_name,
          last_name: input.last_name || null,
          email: input.email || null,
          phone_number: input.phone_number,
          enrollment_status: input.enrollment_status,
          consent_status: input.consent_status,
          notes: input.notes || null,
        })
        .eq("id", student.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Student updated");
      qc.invalidateQueries({ queryKey: ["students"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = editSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit student</DialogTitle>
          <DialogDescription>Update student details and enrollment status.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-first-${student.id}`}>First name</Label>
              <Input
                id={`edit-first-${student.id}`}
                name="first_name"
                required
                maxLength={80}
                defaultValue={student.first_name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-last-${student.id}`}>Last name</Label>
              <Input
                id={`edit-last-${student.id}`}
                name="last_name"
                maxLength={80}
                defaultValue={student.last_name ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-email-${student.id}`}>Email</Label>
            <Input
              id={`edit-email-${student.id}`}
              name="email"
              type="email"
              maxLength={255}
              defaultValue={student.email ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-phone-${student.id}`}>Phone number (E.164)</Label>
            <Input
              id={`edit-phone-${student.id}`}
              name="phone_number"
              required
              maxLength={20}
              defaultValue={student.phone_number}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-enrollment-${student.id}`}>Enrollment status</Label>
              <Select name="enrollment_status" defaultValue={student.enrollment_status}>
                <SelectTrigger id={`edit-enrollment-${student.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="removed">Removed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-consent-${student.id}`}>Consent</Label>
              <Select name="consent_status" defaultValue={student.consent_status}>
                <SelectTrigger id={`edit-consent-${student.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="granted">Granted</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-notes-${student.id}`}>Notes</Label>
            <Textarea
              id={`edit-notes-${student.id}`}
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={student.notes ?? ""}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CsvPreviewRow = {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  consent_status: "pending" | "granted" | "revoked";
};

function ImportCsvDialog({
  bootcamps,
  defaultBootcampId,
}: {
  bootcamps: { id: string; name: string }[];
  defaultBootcampId: string;
}) {
  const [open, setOpen] = useState(false);
  const [bootcampId, setBootcampId] = useState(defaultBootcampId);
  const [preview, setPreview] = useState<CsvPreviewRow[]>([]);
  const qc = useQueryClient();

  const importMut = useMutation({
    mutationFn: async (rows: CsvPreviewRow[]) => {
      let ok = 0;
      let fail = 0;
      for (const row of rows) {
        const { error } = await supabase.from("students").insert({
          bootcamp_id: bootcampId,
          first_name: row.first_name,
          last_name: row.last_name || null,
          email: row.email || null,
          phone_number: row.phone_number,
          consent_status: row.consent_status,
          enrollment_status: "active",
          enrolled_at: new Date().toISOString(),
        });
        if (error) fail++;
        else ok++;
      }
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      toast.success(`Imported ${ok} students${fail ? `, ${fail} failed` : ""}`);
      qc.invalidateQueries({ queryKey: ["students"] });
      setOpen(false);
      setPreview([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = parseCsv(text);
      if (lines.length < 2) return toast.error("CSV must have a header row and at least one data row");
      const header = lines[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const idx = (name: string) => header.indexOf(name);
      const rows: CsvPreviewRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const first = line[idx("first_name")] ?? "";
        const phone = line[idx("phone_number")] ?? "";
        if (!first || !phone) continue;
        const consent = (line[idx("consent_status")] ?? "pending").toLowerCase();
        rows.push({
          first_name: first,
          last_name: line[idx("last_name")] ?? "",
          phone_number: phone,
          email: line[idx("email")] ?? "",
          consent_status:
            consent === "granted" || consent === "revoked" ? consent : "pending",
        });
      }
      setPreview(rows);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview([]); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-1.5" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import students from CSV</DialogTitle>
          <DialogDescription>
            Columns: first_name, last_name, phone_number, email (optional), consent_status (optional).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Bootcamp</Label>
            <Select value={bootcampId} onValueChange={setBootcampId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {bootcamps.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input type="file" accept=".csv,text/csv" onChange={onFile} />
          {preview.length > 0 && (
            <div className="border rounded-md max-h-48 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>First</TableHead>
                    <TableHead>Last</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.first_name}</TableCell>
                      <TableCell>{r.last_name}</TableCell>
                      <TableCell>{r.phone_number}</TableCell>
                      <TableCell>{r.email}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!preview.length || importMut.isPending}
            onClick={() => importMut.mutate(preview)}
          >
            {importMut.isPending ? "Importing…" : `Import ${preview.length} students`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStudentDialog({ bootcamps }: { bootcamps: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: z.infer<typeof addSchema>) => {
      const { error } = await supabase.from("students").insert({
        bootcamp_id: input.bootcamp_id,
        first_name: input.first_name,
        last_name: input.last_name || null,
        email: input.email || null,
        phone_number: input.phone_number,
        notes: input.notes || null,
        consent_status: input.consent_status,
        enrollment_status: "active",
        enrolled_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Student added");
      qc.invalidateQueries({ queryKey: ["students"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = addSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-1.5" /> Add student
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add student</DialogTitle>
          <DialogDescription>
            The phone number is what Make.com uses to identify the student when they message WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bootcamp_id">Bootcamp</Label>
            <Select name="bootcamp_id" defaultValue={bootcamps[0]?.id}>
              <SelectTrigger id="bootcamp_id"><SelectValue /></SelectTrigger>
              <SelectContent>
                {bootcamps.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input id="first_name" name="first_name" required maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input id="last_name" name="last_name" maxLength={80} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" name="email" type="email" maxLength={255} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone_number">Phone number (E.164)</Label>
            <Input id="phone_number" name="phone_number" required placeholder="+27820000000" maxLength={20} />
            <p className="text-xs text-muted-foreground">Must start with + and country code. No spaces.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="consent_status">Consent</Label>
            <Select name="consent_status" defaultValue="granted">
              <SelectTrigger id="consent_status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="granted">Granted</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Adding…" : "Add student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

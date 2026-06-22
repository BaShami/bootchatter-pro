import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  FileText,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useLessonFiles } from "@/hooks/use-lessons";
import { formatDate } from "@/lib/format";
import {
  softDeleteLessonFile,
  restoreLessonFile,
} from "@/lib/lessons.functions";

export function LessonFilesCard({ lessonId }: { lessonId: string }) {
  const qc = useQueryClient();
  const { data: activeFiles } = useLessonFiles(lessonId);
  const { data: deletedFiles } = useLessonFiles(lessonId, { deletedOnly: true });
  const [binOpen, setBinOpen] = useState(false);

  const softDeleteFn = useServerFn(softDeleteLessonFile);
  const restoreFn = useServerFn(restoreLessonFile);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["lesson-files", lessonId] });

  const softDelete = useMutation({
    mutationFn: (fileId: string) => softDeleteFn({ data: { file_id: fileId } }),
    onSuccess: () => {
      toast.success("Moved to recycle bin");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: (fileId: string) => restoreFn({ data: { file_id: fileId } }),
    onSuccess: () => {
      toast.success("File restored");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Files</CardTitle>
        <CardDescription>Originals stored privately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeFiles || activeFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {activeFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 text-sm border border-border rounded-md p-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{f.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.file_size ? `${Math.round(f.file_size / 1024)} KB · ` : ""}
                    {formatDate(f.created_at)}
                  </div>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Move to recycle bin"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64" align="end">
                    <div className="space-y-3">
                      <div className="text-sm font-medium">Move to recycle bin?</div>
                      <p className="text-xs text-muted-foreground">
                        You can restore it later. The original file is kept in storage.
                      </p>
                      <div className="flex justify-end gap-2">
                        <PopoverConfirmButtons
                          onConfirm={() => softDelete.mutate(f.id)}
                          confirmLabel="Confirm"
                          confirmDisabled={softDelete.isPending}
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </li>
            ))}
          </ul>
        )}

        <Collapsible open={binOpen} onOpenChange={setBinOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {binOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Recycle bin ({deletedFiles?.length ?? 0})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {!deletedFiles || deletedFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">Recycle bin is empty.</p>
            ) : (
              <ul className="space-y-2">
                {deletedFiles.map((f) => (
                  <DeletedFileRow
                    key={f.id}
                    file={f}
                    onRestore={() => restore.mutate(f.id)}
                    restoring={restore.isPending}
                  />
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function PopoverConfirmButtons({
  onConfirm,
  confirmLabel,
  confirmDisabled,
}: {
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          // Close the popover by clicking outside-equivalent: dispatch escape
          (e.currentTarget.closest("[data-radix-popper-content-wrapper]") as HTMLElement | null);
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        }}
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={confirmDisabled}
        onClick={() => {
          onConfirm();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        }}
      >
        {confirmLabel}
      </Button>
    </>
  );
}

function DeletedFileRow({
  file,
  onRestore,
  restoring,
}: {
  file: {
    id: string;
    file_name: string;
    file_size: number | null;
    deleted_at: string | null;
    deleted_by: string | null;
  };
  onRestore: () => void;
  restoring: boolean;
}) {
  const { data: deleter } = useQuery({
    queryKey: ["profile-name", file.deleted_by],
    enabled: !!file.deleted_by,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", file.deleted_by!)
        .maybeSingle();
      if (!data) return null;
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
      return name || data.email || "Someone";
    },
  });

  return (
    <li className="flex items-center gap-2 text-sm border border-dashed border-border rounded-md p-2 bg-muted/30">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-muted-foreground line-through">
          {file.file_name}
        </div>
        <div className="text-xs text-muted-foreground">
          Deleted {file.deleted_at ? formatDate(file.deleted_at) : ""}
          {deleter ? ` · by ${deleter}` : ""}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={restoring}
        className="shrink-0"
      >
        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
      </Button>
    </li>
  );
}

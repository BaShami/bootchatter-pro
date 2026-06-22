import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDate } from "@/lib/format";
import {
  uploadKbArticle,
  deleteKbArticle,
  listKbArticles,
} from "@/lib/kb.functions";

const MAX_FILES = 10;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXT = ["txt", "md", "pdf", "docx"];
const ACCEPT = ".txt,.md,.pdf,.docx";

type Tag = "operational" | "reference";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function KnowledgeBaseCard({ bootcampId }: { bootcampId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listKbArticles);
  const uploadFn = useServerFn(uploadKbArticle);
  const deleteFn = useServerFn(deleteKbArticle);

  const articles = useQuery({
    queryKey: ["kb-articles", bootcampId],
    queryFn: () => listFn({ data: { bootcamp_id: bootcampId } }),
  });

  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<Tag>("operational");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["kb-articles", bootcampId] });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file to upload");
      if (!title.trim()) throw new Error("Title is required");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.includes(ext)) throw new Error("Allowed formats: .txt, .md, .pdf, .docx");
      if (file.size > MAX_SIZE) throw new Error("File exceeds 5MB limit");
      if ((articles.data?.length ?? 0) >= MAX_FILES) {
        throw new Error(`Limit reached: max ${MAX_FILES} articles per bootcamp.`);
      }
      const base64 = await fileToBase64(file);
      return uploadFn({
        data: {
          bootcamp_id: bootcampId,
          title: title.trim(),
          tag,
          file_name: file.name,
          file_type: file.type || "application/octet-stream",
          file_size: file.size,
          file_base64: base64,
        },
      });
    },
    onSuccess: () => {
      toast.success("Article uploaded");
      setTitle("");
      setTag("operational");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { article_id: id } }),
    onSuccess: () => {
      toast.success("Article deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const count = articles.data?.length ?? 0;
  const atLimit = count >= MAX_FILES;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Knowledge base</CardTitle>
        <CardDescription>
          Upload reference and operational documents (.txt, .md, .pdf, .docx — max 5MB each, up to {MAX_FILES} per bootcamp).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="kb-title">Title</Label>
            <Input
              id="kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Student Handbook"
              maxLength={200}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kb-tag">Tag</Label>
              <Select value={tag} onValueChange={(v) => setTag(v as Tag)}>
                <SelectTrigger id="kb-tag"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operational</SelectItem>
                  <SelectItem value="reference">Reference</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-file">File</Label>
              <Input
                ref={fileInputRef}
                id="kb-file"
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {count} / {MAX_FILES} articles used
            </p>
            <Button type="submit" disabled={upload.isPending || atLimit}>
              <Upload className="h-4 w-4 mr-1.5" />
              {upload.isPending ? "Uploading…" : "Upload article"}
            </Button>
          </div>
          {atLimit && (
            <p className="text-xs text-destructive">
              Maximum of {MAX_FILES} articles reached. Delete one to add another.
            </p>
          )}
        </form>

        <div>
          {articles.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading articles…</p>
          ) : (articles.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No articles uploaded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.data!.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[260px]">{a.file_name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          a.tag === "operational"
                            ? "bg-blue-100 text-blue-800 border-blue-200"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {a.tag}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(a.created_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${a.title}"?`)) del.mutate(a.id);
                        }}
                        disabled={del.isPending}
                        aria-label="Delete article"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

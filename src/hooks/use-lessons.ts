import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type LessonRow = Database["public"]["Tables"]["lessons"]["Row"];
export type LessonFileRow = Database["public"]["Tables"]["lesson_files"]["Row"];
export type LessonStatus = Database["public"]["Enums"]["lesson_status"];

export function useLessons(
  bootcampId: string | undefined,
  opts: { includeDeleted?: boolean; deletedOnly?: boolean } = {},
) {
  const { includeDeleted = false, deletedOnly = false } = opts;
  return useQuery({
    queryKey: ["lessons", bootcampId, { includeDeleted, deletedOnly }],
    enabled: !!bootcampId,
    queryFn: async (): Promise<LessonRow[]> => {
      let q = supabase
        .from("lessons")
        .select("*")
        .eq("bootcamp_id", bootcampId!)
        .order("lesson_number", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (deletedOnly) q = q.not("deleted_at", "is", null);
      else if (!includeDeleted) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLesson(id: string | undefined, opts: { includeDeleted?: boolean } = {}) {
  const { includeDeleted = false } = opts;
  return useQuery({
    queryKey: ["lesson", id, { includeDeleted }],
    enabled: !!id,
    queryFn: async () => {
      let q = supabase.from("lessons").select("*").eq("id", id!);
      if (!includeDeleted) q = q.is("deleted_at", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useLessonFiles(
  lessonId: string | undefined,
  opts: { includeDeleted?: boolean; deletedOnly?: boolean } = {},
) {
  const { includeDeleted = false, deletedOnly = false } = opts;
  return useQuery({
    queryKey: ["lesson-files", lessonId, { includeDeleted, deletedOnly }],
    enabled: !!lessonId,
    queryFn: async (): Promise<LessonFileRow[]> => {
      let q = supabase
        .from("lesson_files")
        .select("*")
        .eq("lesson_id", lessonId!)
        .order("created_at", { ascending: false });
      if (deletedOnly) q = q.not("deleted_at", "is", null);
      else if (!includeDeleted) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}


export function useLessonChunkCount(lessonId: string | undefined) {
  return useQuery({
    queryKey: ["lesson-chunk-count", lessonId],
    enabled: !!lessonId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lesson_chunks")
        .select("id", { count: "exact", head: true })
        .eq("lesson_id", lessonId!);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

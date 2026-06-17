import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type LessonRow = Database["public"]["Tables"]["lessons"]["Row"];
export type LessonFileRow = Database["public"]["Tables"]["lesson_files"]["Row"];
export type LessonStatus = Database["public"]["Enums"]["lesson_status"];

export function useLessons(bootcampId: string | undefined) {
  return useQuery({
    queryKey: ["lessons", bootcampId],
    enabled: !!bootcampId,
    queryFn: async (): Promise<LessonRow[]> => {
      const { data, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("bootcamp_id", bootcampId!)
        .order("lesson_number", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLesson(id: string | undefined) {
  return useQuery({
    queryKey: ["lesson", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useLessonFiles(lessonId: string | undefined) {
  return useQuery({
    queryKey: ["lesson-files", lessonId],
    enabled: !!lessonId,
    queryFn: async (): Promise<LessonFileRow[]> => {
      const { data, error } = await supabase
        .from("lesson_files")
        .select("*")
        .eq("lesson_id", lessonId!)
        .order("created_at", { ascending: false });
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

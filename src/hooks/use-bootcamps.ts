import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BootcampRow = {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "draft" | "active" | "completed" | "archived";
  timezone: string;
  created_at: string;
};

export function useBootcamps() {
  return useQuery({
    queryKey: ["bootcamps"],
    queryFn: async (): Promise<BootcampRow[]> => {
      const { data, error } = await supabase
        .from("bootcamps")
        .select("id, name, description, start_date, end_date, status, timezone, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BootcampRow[];
    },
  });
}

export function useBootcamp(id: string | undefined) {
  return useQuery({
    queryKey: ["bootcamps", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bootcamps")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

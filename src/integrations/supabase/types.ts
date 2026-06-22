export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          bootcamp_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          bootcamp_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          bootcamp_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_recipients: {
        Row: {
          announcement_id: string
          created_at: string
          id: string
          processing_status: Database["public"]["Enums"]["recipient_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          id?: string
          processing_status?: Database["public"]["Enums"]["recipient_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          id?: string
          processing_status?: Database["public"]["Enums"]["recipient_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_recipients_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audience_type: Database["public"]["Enums"]["announcement_audience"]
          bootcamp_id: string
          created_at: string
          created_by: string | null
          delivered_count: number
          failed_count: number
          id: string
          message: string
          processed_at: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at: string
          webhook_payload: Json | null
        }
        Insert: {
          audience_type?: Database["public"]["Enums"]["announcement_audience"]
          bootcamp_id: string
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          message: string
          processed_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at?: string
          webhook_payload?: Json | null
        }
        Update: {
          audience_type?: Database["public"]["Enums"]["announcement_audience"]
          bootcamp_id?: string
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          message?: string
          processed_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title?: string
          updated_at?: string
          webhook_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      bootcamp_members: {
        Row: {
          bootcamp_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["bootcamp_role"]
          status: string
          user_id: string
        }
        Insert: {
          bootcamp_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["bootcamp_role"]
          status?: string
          user_id: string
        }
        Update: {
          bootcamp_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["bootcamp_role"]
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bootcamp_members_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      bootcamp_settings: {
        Row: {
          ai_instructions: string | null
          ai_model: string | null
          announcement_method: Database["public"]["Enums"]["announcement_method"]
          bootcamp_id: string
          created_at: string
          fallback_answer: string | null
          file_search_result_limit: number
          full_text_result_limit: number
          id: string
          make_webhook_url: string | null
          student_onboarding_webhook_url: string | null
          max_answer_length: number | null
          minimum_similarity: number | null
          openai_vector_store_id: string | null
          retrieval_limit: number | null
          updated_at: string
          vector_store_status: string
        }
        Insert: {
          ai_instructions?: string | null
          ai_model?: string | null
          announcement_method?: Database["public"]["Enums"]["announcement_method"]
          bootcamp_id: string
          created_at?: string
          fallback_answer?: string | null
          file_search_result_limit?: number
          full_text_result_limit?: number
          id?: string
          make_webhook_url?: string | null
          student_onboarding_webhook_url?: string | null
          max_answer_length?: number | null
          minimum_similarity?: number | null
          openai_vector_store_id?: string | null
          retrieval_limit?: number | null
          updated_at?: string
          vector_store_status?: string
        }
        Update: {
          ai_instructions?: string | null
          ai_model?: string | null
          announcement_method?: Database["public"]["Enums"]["announcement_method"]
          bootcamp_id?: string
          created_at?: string
          fallback_answer?: string | null
          file_search_result_limit?: number
          full_text_result_limit?: number
          id?: string
          make_webhook_url?: string | null
          student_onboarding_webhook_url?: string | null
          max_answer_length?: number | null
          minimum_similarity?: number | null
          openai_vector_store_id?: string | null
          retrieval_limit?: number | null
          updated_at?: string
          vector_store_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bootcamp_settings_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: true
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      bootcamps: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: Database["public"]["Enums"]["bootcamp_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["bootcamp_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["bootcamp_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          bootcamp_ids: string[]
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["bootcamp_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          bootcamp_ids: string[]
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["bootcamp_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          bootcamp_ids?: string[]
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["bootcamp_role"]
          status?: string
          token?: string
        }
        Relationships: []
      }
      lesson_chunks: {
        Row: {
          bootcamp_id: string
          chunk_index: number
          chunk_text: string
          created_at: string
          embedding: string | null
          full_text_metadata: Json | null
          id: string
          lesson_id: string
          metadata: Json | null
          search_content: string | null
          search_vector: unknown
        }
        Insert: {
          bootcamp_id: string
          chunk_index: number
          chunk_text: string
          created_at?: string
          embedding?: string | null
          full_text_metadata?: Json | null
          id?: string
          lesson_id: string
          metadata?: Json | null
          search_content?: string | null
          search_vector?: unknown
        }
        Update: {
          bootcamp_id?: string
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedding?: string | null
          full_text_metadata?: Json | null
          id?: string
          lesson_id?: string
          metadata?: Json | null
          search_content?: string | null
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "lesson_chunks_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_chunks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_files: {
        Row: {
          bootcamp_id: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          lesson_id: string
          mime_type: string | null
          storage_path: string
        }
        Insert: {
          bootcamp_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          lesson_id: string
          mime_type?: string | null
          storage_path: string
        }
        Update: {
          bootcamp_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          lesson_id?: string
          mime_type?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_files_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_files_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          bootcamp_id: string
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          indexing_started_at: string | null
          key_topics: string[] | null
          last_synced_at: string | null
          learning_objectives: string | null
          lesson_date: string | null
          lesson_number: number | null
          module_name: string | null
          openai_file_id: string | null
          openai_indexed_at: string | null
          openai_indexing_status: string
          openai_sync_error: string | null
          published_at: string | null
          status: Database["public"]["Enums"]["lesson_status"]
          summary: string | null
          title: string
          transcript: string | null
          updated_at: string
        }
        Insert: {
          bootcamp_id: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          indexing_started_at?: string | null
          key_topics?: string[] | null
          last_synced_at?: string | null
          learning_objectives?: string | null
          lesson_date?: string | null
          lesson_number?: number | null
          module_name?: string | null
          openai_file_id?: string | null
          openai_indexed_at?: string | null
          openai_indexing_status?: string
          openai_sync_error?: string | null
          published_at?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          summary?: string | null
          title: string
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          bootcamp_id?: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          indexing_started_at?: string | null
          key_topics?: string[] | null
          last_synced_at?: string | null
          learning_objectives?: string | null
          lesson_date?: string | null
          lesson_number?: number | null
          module_name?: string | null
          openai_file_id?: string | null
          openai_indexed_at?: string | null
          openai_indexing_status?: string
          openai_sync_error?: string | null
          published_at?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          summary?: string | null
          title?: string
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_requests: {
        Row: {
          actioned_at: string | null
          actioned_by: string | null
          email: string
          id: string
          requested_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          actioned_at?: string | null
          actioned_by?: string | null
          email: string
          id?: string
          requested_at?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          actioned_at?: string | null
          actioned_by?: string | null
          email?: string
          id?: string
          requested_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          password_reset_expires_at: string | null
          password_reset_token: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          password_reset_expires_at?: string | null
          password_reset_token?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          password_reset_expires_at?: string | null
          password_reset_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          ai_answer: string | null
          bootcamp_id: string
          confidence_score: number | null
          created_at: string
          external_message_id: string | null
          file_search_results: Json | null
          file_search_used: boolean
          full_text_results: Json | null
          id: string
          instructor_answer: string | null
          metadata: Json | null
          openai_response_id: string | null
          question_text: string
          referenced_lessons: string[] | null
          retrieval_debug: Json | null
          retrieval_method: string | null
          retrieved_chunks: Json | null
          review_status: Database["public"]["Enums"]["review_status"]
          source_lessons: Json | null
          student_id: string | null
          updated_at: string
        }
        Insert: {
          ai_answer?: string | null
          bootcamp_id: string
          confidence_score?: number | null
          created_at?: string
          external_message_id?: string | null
          file_search_results?: Json | null
          file_search_used?: boolean
          full_text_results?: Json | null
          id?: string
          instructor_answer?: string | null
          metadata?: Json | null
          openai_response_id?: string | null
          question_text: string
          referenced_lessons?: string[] | null
          retrieval_debug?: Json | null
          retrieval_method?: string | null
          retrieved_chunks?: Json | null
          review_status?: Database["public"]["Enums"]["review_status"]
          source_lessons?: Json | null
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_answer?: string | null
          bootcamp_id?: string
          confidence_score?: number | null
          created_at?: string
          external_message_id?: string | null
          file_search_results?: Json | null
          file_search_used?: boolean
          full_text_results?: Json | null
          id?: string
          instructor_answer?: string | null
          metadata?: Json | null
          openai_response_id?: string | null
          question_text?: string
          referenced_lessons?: string[] | null
          retrieval_debug?: Json | null
          retrieval_method?: string | null
          retrieved_chunks?: Json | null
          review_status?: Database["public"]["Enums"]["review_status"]
          source_lessons?: Json | null
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_sessions: {
        Row: {
          answers: Json
          bootcamp_id: string
          created_at: string
          current_question: number
          id: string
          lesson_id: string
          questions: Json
          score: number | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          bootcamp_id: string
          created_at?: string
          current_question?: number
          id?: string
          lesson_id: string
          questions: Json
          score?: number | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          bootcamp_id?: string
          created_at?: string
          current_question?: number
          id?: string
          lesson_id?: string
          questions?: Json
          score?: number | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_sessions_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_sessions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_history: {
        Row: {
          action: string
          actioned_at: string
          actioned_by: string | null
          bootcamp_id: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          role: Database["public"]["Enums"]["bootcamp_role"]
          user_id: string | null
        }
        Insert: {
          action: string
          actioned_at?: string
          actioned_by?: string | null
          bootcamp_id: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          role: Database["public"]["Enums"]["bootcamp_role"]
          user_id?: string | null
        }
        Update: {
          action?: string
          actioned_at?: string
          actioned_by?: string | null
          bootcamp_id?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          role?: Database["public"]["Enums"]["bootcamp_role"]
          user_id?: string | null
        }
        Relationships: []
      }
      students: {
        Row: {
          bootcamp_id: string
          consent_status: Database["public"]["Enums"]["consent_status"]
          created_at: string
          email: string | null
          enrolled_at: string | null
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          first_name: string
          id: string
          last_active_at: string | null
          last_name: string | null
          notes: string | null
          phone_number: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          bootcamp_id: string
          consent_status?: Database["public"]["Enums"]["consent_status"]
          created_at?: string
          email?: string | null
          enrolled_at?: string | null
          enrollment_status?: Database["public"]["Enums"]["enrollment_status"]
          first_name: string
          id?: string
          last_active_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone_number: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          bootcamp_id?: string
          consent_status?: Database["public"]["Enums"]["consent_status"]
          created_at?: string
          email?: string | null
          enrolled_at?: string | null
          enrollment_status?: Database["public"]["Enums"]["enrollment_status"]
          first_name?: string
          id?: string
          last_active_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone_number?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_bootcamp_id_fkey"
            columns: ["bootcamp_id"]
            isOneToOne: false
            referencedRelation: "bootcamps"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_cron_secret: { Args: never; Returns: string }
      get_invite_by_token: {
        Args: { _token: string }
        Returns: {
          bootcamp_ids: string[]
          bootcamp_names: string[]
          email: string
          expired: boolean
          expires_at: string
          id: string
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_bootcamp_admin: {
        Args: { _bootcamp_id: string; _user_id: string }
        Returns: boolean
      }
      is_bootcamp_member: {
        Args: { _bootcamp_id: string; _user_id: string }
        Returns: boolean
      }
      is_bootcamp_teacher: {
        Args: { _bootcamp_id: string; _user_id: string }
        Returns: boolean
      }
      match_lesson_chunks: {
        Args: {
          match_count?: number
          min_similarity?: number
          p_bootcamp_id: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          chunk_text: string
          lesson_id: string
          lesson_title: string
          similarity: number
        }[]
      }
      search_published_lesson_chunks: {
        Args: { p_bootcamp_id: string; p_limit?: number; p_query: string }
        Returns: {
          chunk_id: string
          chunk_text: string
          lesson_id: string
          lesson_title: string
          rank: number
        }[]
      }
    }
    Enums: {
      announcement_audience: "all" | "specific"
      announcement_method: "pull" | "push"
      announcement_status:
        | "draft"
        | "scheduled"
        | "ready"
        | "processing"
        | "completed"
        | "cancelled"
      app_role: "platform_admin"
      bootcamp_role: "admin" | "teacher"
      bootcamp_status: "draft" | "active" | "completed" | "archived"
      consent_status: "pending" | "granted" | "revoked"
      enrollment_status:
        | "invited"
        | "active"
        | "suspended"
        | "completed"
        | "removed"
      lesson_status:
        | "draft"
        | "processing"
        | "ready"
        | "published"
        | "failed"
        | "archived"
      recipient_status: "pending" | "sent" | "failed"
      review_status:
        | "unreviewed"
        | "correct"
        | "incorrect"
        | "instructor_answered"
        | "unresolved"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      announcement_audience: ["all", "specific"],
      announcement_method: ["pull", "push"],
      announcement_status: [
        "draft",
        "scheduled",
        "ready",
        "processing",
        "completed",
        "cancelled",
      ],
      app_role: ["platform_admin"],
      bootcamp_role: ["admin", "teacher"],
      bootcamp_status: ["draft", "active", "completed", "archived"],
      consent_status: ["pending", "granted", "revoked"],
      enrollment_status: [
        "invited",
        "active",
        "suspended",
        "completed",
        "removed",
      ],
      lesson_status: [
        "draft",
        "processing",
        "ready",
        "published",
        "failed",
        "archived",
      ],
      recipient_status: ["pending", "sent", "failed"],
      review_status: [
        "unreviewed",
        "correct",
        "incorrect",
        "instructor_answered",
        "unresolved",
      ],
    },
  },
} as const

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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          created_at: string
          created_by: string | null
          department: string
          doctor_id: string | null
          duration_min: number
          id: string
          notes: string | null
          patient_id: string
          reason: string | null
          starts_at: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department?: string
          doctor_id?: string | null
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id: string
          reason?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department?: string
          doctor_id?: string | null
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id?: string
          reason?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          at: string
          by_id: string | null
          by_name: string
          id: string
          op: string
          role: string
          section: string
          summary: string
          version: number
        }
        Insert: {
          at: string
          by_id?: string | null
          by_name?: string
          id: string
          op: string
          role?: string
          section?: string
          summary?: string
          version: number
        }
        Update: {
          at?: string
          by_id?: string | null
          by_name?: string
          id?: string
          op?: string
          role?: string
          section?: string
          summary?: string
          version?: number
        }
        Relationships: []
      }
      hospital_chunks: {
        Row: {
          data: Json | null
          key: string
          updated_at: string
          version: number
        }
        Insert: {
          data?: Json | null
          key: string
          updated_at?: string
          version?: number
        }
        Update: {
          data?: Json | null
          key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      hospital_restore_points: {
        Row: {
          data: Json | null
          day: string
          key: string
          saved_at: string
          version: number
        }
        Insert: {
          data?: Json | null
          day: string
          key: string
          saved_at?: string
          version: number
        }
        Update: {
          data?: Json | null
          day?: string
          key?: string
          saved_at?: string
          version?: number
        }
        Relationships: []
      }
      hospital_state: {
        Row: {
          data: Json
          id: number
          updated_at: string
          version: number
        }
        Insert: {
          data?: Json
          id?: number
          updated_at?: string
          version?: number
        }
        Update: {
          data?: Json
          id?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      hospital_state_meta: {
        Row: {
          id: number
          updated_at: string
          version: number
        }
        Insert: {
          id?: number
          updated_at?: string
          version?: number
        }
        Update: {
          id?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lab_orders: {
        Row: {
          created_at: string
          created_by: string | null
          doctor_id: string | null
          id: string
          notes: string | null
          order_no: string
          ordered_at: string
          patient_id: string
          result_at: string | null
          status: string
          tests: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          order_no?: string
          ordered_at?: string
          patient_id: string
          result_at?: string | null
          status?: string
          tests?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          order_no?: string
          ordered_at?: string
          patient_id?: string
          result_at?: string | null
          status?: string
          tests?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_visits: {
        Row: {
          complaint: string | null
          created_at: string
          created_by: string | null
          department: string
          diagnosis: string | null
          doctor_id: string | null
          id: string
          notes: string | null
          patient_id: string
          prescription: string | null
          visit_date: string
          vitals: Json
        }
        Insert: {
          complaint?: string | null
          created_at?: string
          created_by?: string | null
          department?: string
          diagnosis?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          prescription?: string | null
          visit_date?: string
          vitals?: Json
        }
        Update: {
          complaint?: string | null
          created_at?: string
          created_by?: string | null
          department?: string
          diagnosis?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          prescription?: string | null
          visit_date?: string
          vitals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "medical_visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          allergies: string | null
          birth_date: string | null
          blood_type: string | null
          chronic_conditions: string | null
          created_at: string
          created_by: string | null
          emergency_contact: string | null
          full_name: string
          gender: string | null
          id: string
          mrn: string
          national_id: string | null
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          birth_date?: string | null
          blood_type?: string | null
          chronic_conditions?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact?: string | null
          full_name: string
          gender?: string | null
          id?: string
          mrn?: string
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string | null
          birth_date?: string | null
          blood_type?: string | null
          chronic_conditions?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          mrn?: string
          national_id?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          box_id: string | null
          controls: Json | null
          created_at: string
          full_name: string
          id: string
          permissions: Json | null
          username: string
        }
        Insert: {
          active?: boolean
          box_id?: string | null
          controls?: Json | null
          created_at?: string
          full_name?: string
          id: string
          permissions?: Json | null
          username: string
        }
        Update: {
          active?: boolean
          box_id?: string | null
          controls?: Json | null
          created_at?: string
          full_name?: string
          id?: string
          permissions?: Json | null
          username?: string
        }
        Relationships: []
      }
      stored_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          kind: string
          mime_type: string
          owner_id: string
          owner_kind: string
          path: string
          ref_id: string | null
          size_bytes: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string
          id?: string
          kind: string
          mime_type?: string
          owner_id: string
          owner_kind: string
          path: string
          ref_id?: string | null
          size_bytes?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          kind?: string
          mime_type?: string
          owner_id?: string
          owner_kind?: string
          path?: string
          ref_id?: string | null
          size_bytes?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_staff: { Args: { _user_id: string }; Returns: boolean }
      list_restore_days: {
        Args: never
        Returns: {
          day: string
          first_saved: string
          pieces: number
        }[]
      }
      prune_restore_points: { Args: never; Returns: undefined }
      restore_hospital_to_day: { Args: { _day: string }; Returns: number }
      save_hospital_chunks: {
        Args: { _audit: Json; _chunks: Json; _expected: number }
        Returns: number
      }
      save_hospital_state: {
        Args: { _data: Json; _expected: number }
        Returns: number
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "finance"
        | "reception"
        | "auditor"
        | "accountant"
        | "lab_manager"
        | "icu_manager"
        | "radiologist"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "admin",
        "finance",
        "reception",
        "auditor",
        "accountant",
        "lab_manager",
        "icu_manager",
        "radiologist",
      ],
    },
  },
} as const

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
      bills: {
        Row: {
          code: string
          created_at: string
          hold_amount_pence: number
          host_account_number: string | null
          host_monzo: string | null
          host_name: string | null
          host_revolut: string | null
          host_sort_code: string | null
          host_stripe_account_id: string | null
          id: string
          mode: string
          restaurant_name: string
          settled_at: string | null
          status: string
          wheel_pay_to: string
          wheel_spun_at: string | null
          wheel_winner_id: string | null
          youmustpay: boolean
        }
        Insert: {
          code: string
          created_at?: string
          hold_amount_pence?: number
          host_account_number?: string | null
          host_monzo?: string | null
          host_name?: string | null
          host_revolut?: string | null
          host_sort_code?: string | null
          host_stripe_account_id?: string | null
          id?: string
          mode?: string
          restaurant_name?: string
          settled_at?: string | null
          status?: string
          wheel_pay_to?: string
          wheel_spun_at?: string | null
          wheel_winner_id?: string | null
          youmustpay?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          hold_amount_pence?: number
          host_account_number?: string | null
          host_monzo?: string | null
          host_name?: string | null
          host_revolut?: string | null
          host_sort_code?: string | null
          host_stripe_account_id?: string | null
          id?: string
          mode?: string
          restaurant_name?: string
          settled_at?: string | null
          status?: string
          wheel_pay_to?: string
          wheel_spun_at?: string | null
          wheel_winner_id?: string | null
          youmustpay?: boolean
        }
        Relationships: []
      }
      claims: {
        Row: {
          bill_id: string
          created_at: string
          guest_id: string
          id: string
          item_id: string
        }
        Insert: {
          bill_id: string
          created_at?: string
          guest_id: string
          id?: string
          item_id: string
        }
        Update: {
          bill_id?: string
          created_at?: string
          guest_id?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          bill_id: string
          color: string
          created_at: string
          emoji: string
          has_phone: boolean
          id: string
          in_wheel: boolean
          is_host: boolean
          name: string
          paid_at: string | null
          paid_via: string | null
          payment_status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          bill_id: string
          color?: string
          created_at?: string
          emoji?: string
          has_phone?: boolean
          id?: string
          in_wheel?: boolean
          is_host?: boolean
          name: string
          paid_at?: string | null
          paid_via?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          bill_id?: string
          color?: string
          created_at?: string
          emoji?: string
          has_phone?: boolean
          id?: string
          in_wheel?: boolean
          is_host?: boolean
          name?: string
          paid_at?: string | null
          paid_via?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          bill_id: string
          id: string
          name: string
          position: number
          price_pence: number
          receipt_id: string
        }
        Insert: {
          bill_id: string
          id?: string
          name: string
          position?: number
          price_pence: number
          receipt_id: string
        }
        Update: {
          bill_id?: string
          id?: string
          name?: string
          position?: number
          price_pence?: number
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          bill_id: string
          discount_pence: number | null
          id: string
          label: string
          position: number
          receipt_total_pence: number | null
          service_included_pence: number
          service_mode: string
          service_rate: number
        }
        Insert: {
          bill_id: string
          discount_pence?: number | null
          id?: string
          label?: string
          position?: number
          receipt_total_pence?: number | null
          service_included_pence?: number
          service_mode?: string
          service_rate?: number
        }
        Update: {
          bill_id?: string
          discount_pence?: number | null
          id?: string
          label?: string
          position?: number
          receipt_total_pence?: number | null
          service_included_pence?: number
          service_mode?: string
          service_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_tables: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

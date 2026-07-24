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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _migrations: {
        Row: {
          applied_at: string
          name: string
        }
        Insert: {
          applied_at?: string
          name: string
        }
        Update: {
          applied_at?: string
          name?: string
        }
        Relationships: []
      }
      observation_events: {
        Row: {
          entity_key: string
          entity_type: string
          event_type: string
          field_name: string
          id: number
          metadata: Json | null
          new_value_raw: string | null
          observed_at: string
          old_value_raw: string | null
          scan_run_id: string
        }
        Insert: {
          entity_key: string
          entity_type: string
          event_type: string
          field_name?: string
          id?: number
          metadata?: Json | null
          new_value_raw?: string | null
          observed_at: string
          old_value_raw?: string | null
          scan_run_id: string
        }
        Update: {
          entity_key?: string
          entity_type?: string
          event_type?: string
          field_name?: string
          id?: number
          metadata?: Json | null
          new_value_raw?: string | null
          observed_at?: string
          old_value_raw?: string | null
          scan_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "observation_events_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "observation_events_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          bbx_listing_id: string
          bottle_volume_ml: number | null
          case_size: number | null
          consecutive_misses: number
          first_seen_at: string
          first_seen_run_id: string | null
          format_code: string | null
          gone_since: string | null
          last_seen_at: string
          last_seen_run_id: string | null
          match_confidence: string | null
          parent_sku: string
          price_per_case_p: number
        }
        Insert: {
          bbx_listing_id: string
          bottle_volume_ml?: number | null
          case_size?: number | null
          consecutive_misses?: number
          first_seen_at: string
          first_seen_run_id?: string | null
          format_code?: string | null
          gone_since?: string | null
          last_seen_at: string
          last_seen_run_id?: string | null
          match_confidence?: string | null
          parent_sku: string
          price_per_case_p: number
        }
        Update: {
          bbx_listing_id?: string
          bottle_volume_ml?: number | null
          case_size?: number | null
          consecutive_misses?: number
          first_seen_at?: string
          first_seen_run_id?: string | null
          format_code?: string | null
          gone_since?: string | null
          last_seen_at?: string
          last_seen_run_id?: string | null
          match_confidence?: string | null
          parent_sku?: string
          price_per_case_p?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "offers_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "offers_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "product_detail_view"
            referencedColumns: ["parent_sku"]
          },
          {
            foreignKeyName: "offers_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["parent_sku"]
          },
        ]
      }
      products: {
        Row: {
          colour: string | null
          consecutive_misses: number
          country: string | null
          first_seen_at: string
          first_seen_run_id: string | null
          gone_since: string | null
          grape_varieties: string[] | null
          last_rest_checked_at: string | null
          last_seen_at: string
          last_seen_run_id: string | null
          name: string | null
          parent_sku: string
          producer: string | null
          product_url: string | null
          region: string | null
          subregion: string | null
          vintage: number | null
        }
        Insert: {
          colour?: string | null
          consecutive_misses?: number
          country?: string | null
          first_seen_at: string
          first_seen_run_id?: string | null
          gone_since?: string | null
          grape_varieties?: string[] | null
          last_rest_checked_at?: string | null
          last_seen_at: string
          last_seen_run_id?: string | null
          name?: string | null
          parent_sku: string
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
        }
        Update: {
          colour?: string | null
          consecutive_misses?: number
          country?: string | null
          first_seen_at?: string
          first_seen_run_id?: string | null
          gone_since?: string | null
          grape_varieties?: string[] | null
          last_rest_checked_at?: string | null
          last_seen_at?: string
          last_seen_run_id?: string | null
          name?: string | null
          parent_sku?: string
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "products_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "products_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_runs: {
        Row: {
          algolia_complete: boolean | null
          algolia_hits_collected: number | null
          algolia_hits_expected: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          rest_failed_skus: string[] | null
          rest_skus_expected: number | null
          rest_skus_failed: number | null
          rest_skus_priced: number | null
          run_date: string
          scope: string
          started_at: string
          status: string
          wave_delta_changed_count: number | null
          wave_delta_enabled: boolean | null
          wave_priced_count: number | null
          wave_rotation_count: number | null
          wave_shadow_only_count: number | null
        }
        Insert: {
          algolia_complete?: boolean | null
          algolia_hits_collected?: number | null
          algolia_hits_expected?: number | null
          error_message?: string | null
          finished_at?: string | null
          id: string
          rest_failed_skus?: string[] | null
          rest_skus_expected?: number | null
          rest_skus_failed?: number | null
          rest_skus_priced?: number | null
          run_date: string
          scope: string
          started_at: string
          status?: string
          wave_delta_changed_count?: number | null
          wave_delta_enabled?: boolean | null
          wave_priced_count?: number | null
          wave_rotation_count?: number | null
          wave_shadow_only_count?: number | null
        }
        Update: {
          algolia_complete?: boolean | null
          algolia_hits_collected?: number | null
          algolia_hits_expected?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          rest_failed_skus?: string[] | null
          rest_skus_expected?: number | null
          rest_skus_failed?: number | null
          rest_skus_priced?: number | null
          run_date?: string
          scope?: string
          started_at?: string
          status?: string
          wave_delta_changed_count?: number | null
          wave_delta_enabled?: boolean | null
          wave_priced_count?: number | null
          wave_rotation_count?: number | null
          wave_shadow_only_count?: number | null
        }
        Relationships: []
      }
      skus: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          consecutive_misses: number
          first_seen_at: string
          first_seen_run_id: string | null
          format_code: string
          gone_since: string | null
          highest_bid_p: number | null
          is_listed: boolean
          last_seen_at: string
          last_seen_run_id: string | null
          last_transaction_p: number | null
          least_listing_price_p: number | null
          market_price_p: number | null
          parent_sku: string
          qty_available: number | null
          source_agreement: string | null
        }
        Insert: {
          bottle_volume_ml?: number | null
          case_size?: number | null
          consecutive_misses?: number
          first_seen_at: string
          first_seen_run_id?: string | null
          format_code: string
          gone_since?: string | null
          highest_bid_p?: number | null
          is_listed?: boolean
          last_seen_at: string
          last_seen_run_id?: string | null
          last_transaction_p?: number | null
          least_listing_price_p?: number | null
          market_price_p?: number | null
          parent_sku: string
          qty_available?: number | null
          source_agreement?: string | null
        }
        Update: {
          bottle_volume_ml?: number | null
          case_size?: number | null
          consecutive_misses?: number
          first_seen_at?: string
          first_seen_run_id?: string | null
          format_code?: string
          gone_since?: string | null
          highest_bid_p?: number | null
          is_listed?: boolean
          last_seen_at?: string
          last_seen_run_id?: string | null
          last_transaction_p?: number | null
          least_listing_price_p?: number | null
          market_price_p?: number | null
          parent_sku?: string
          qty_available?: number | null
          source_agreement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skus_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "skus_first_seen_run_id_fkey"
            columns: ["first_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skus_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "skus_last_seen_run_id_fkey"
            columns: ["last_seen_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "product_detail_view"
            referencedColumns: ["parent_sku"]
          },
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["parent_sku"]
          },
        ]
      }
    }
    Views: {
      candidate_view: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          country: string | null
          first_seen_at: string | null
          format_code: string | null
          highest_bid_p: number | null
          is_active: boolean | null
          last_seen_at: string | null
          last_transaction_p: number | null
          least_listing_price_p: number | null
          market_price_p: number | null
          name: string | null
          next_lowest_price_p: number | null
          parent_sku: string | null
          pct_last: number | null
          pct_market: number | null
          pct_next: number | null
          producer: string | null
          product_url: string | null
          qty_available: number | null
          region: string | null
          signal_type: string | null
          source_agreement: string | null
          subregion: string | null
          vintage: number | null
        }
        Relationships: [
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "product_detail_view"
            referencedColumns: ["parent_sku"]
          },
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["parent_sku"]
          },
        ]
      }
      catalogue_view: {
        Row: {
          adjusted_guide_p: number | null
          ask: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          country: string | null
          first_seen_at: string | null
          format_code: string | null
          highest_bid_p: number | null
          last_rest_checked_at: string | null
          last_seen_at: string | null
          last_transaction_p: number | null
          market_price_p: number | null
          name: string | null
          next_lowest_price_p: number | null
          parent_sku: string | null
          price_per_bottle_p: number | null
          price_per_litre_p: number | null
          price_vs_adjusted_guide_pct: number | null
          price_vs_last_pct: number | null
          price_vs_market_pct: number | null
          price_vs_next_pct: number | null
          producer: string | null
          product_url: string | null
          qty_available: number | null
          region: string | null
          signal_type: string | null
          source_agreement: string | null
          subregion: string | null
          vintage: number | null
        }
        Relationships: [
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "product_detail_view"
            referencedColumns: ["parent_sku"]
          },
          {
            foreignKeyName: "skus_parent_sku_fkey"
            columns: ["parent_sku"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["parent_sku"]
          },
        ]
      }
      facet_ranges_view: {
        Row: {
          ask_max: number | null
          ask_min: number | null
          bottle_volume_ml_max: number | null
          bottle_volume_ml_min: number | null
          case_size_max: number | null
          case_size_min: number | null
          first_seen_at_max: string | null
          first_seen_at_min: string | null
          last_seen_at_max: string | null
          last_seen_at_min: string | null
          vintage_max: number | null
          vintage_min: number | null
        }
        Relationships: []
      }
      facet_values_view: {
        Row: {
          facet: string | null
          n: number | null
          value: string | null
        }
        Relationships: []
      }
      format_options_view: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          format_code: string | null
          n: number | null
        }
        Relationships: []
      }
      price_history_view: {
        Row: {
          entity_key: string | null
          event_id: number | null
          field_name: string | null
          format_code: string | null
          new_value_raw: string | null
          observed_at: string | null
          old_value_raw: string | null
          parent_sku: string | null
          scan_run_id: string | null
        }
        Insert: {
          entity_key?: string | null
          event_id?: number | null
          field_name?: string | null
          format_code?: never
          new_value_raw?: string | null
          observed_at?: string | null
          old_value_raw?: string | null
          parent_sku?: never
          scan_run_id?: string | null
        }
        Update: {
          entity_key?: string | null
          event_id?: number | null
          field_name?: string | null
          format_code?: never
          new_value_raw?: string | null
          observed_at?: string | null
          old_value_raw?: string | null
          parent_sku?: never
          scan_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observation_events_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "scan_health_view"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "observation_events_scan_run_id_fkey"
            columns: ["scan_run_id"]
            isOneToOne: false
            referencedRelation: "scan_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      product_detail_view: {
        Row: {
          active_offer_count: number | null
          active_sku_count: number | null
          best_pct_market: number | null
          colour: string | null
          country: string | null
          first_seen_at: string | null
          grape_varieties: string[] | null
          is_active: boolean | null
          last_seen_at: string | null
          name: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          region: string | null
          subregion: string | null
          vintage: number | null
        }
        Insert: {
          active_offer_count?: never
          active_sku_count?: never
          best_pct_market?: never
          colour?: string | null
          country?: string | null
          first_seen_at?: string | null
          grape_varieties?: string[] | null
          is_active?: never
          last_seen_at?: string | null
          name?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
        }
        Update: {
          active_offer_count?: never
          active_sku_count?: never
          best_pct_market?: never
          colour?: string | null
          country?: string | null
          first_seen_at?: string | null
          grape_varieties?: string[] | null
          is_active?: never
          last_seen_at?: string | null
          name?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
        }
        Relationships: []
      }
      recent_price_change_view: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          country: string | null
          field_name: string | null
          format_code: string | null
          name: string | null
          new_value_raw: string | null
          observed_at: string | null
          old_value_raw: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          region: string | null
          subregion: string | null
          vintage: number | null
        }
        Relationships: []
      }
      scan_health_view: {
        Row: {
          algolia_complete: boolean | null
          algolia_hits_collected: number | null
          algolia_hits_expected: number | null
          duration_seconds: number | null
          error_message: string | null
          finished_at: string | null
          rest_failed_skus: string[] | null
          rest_skus_expected: number | null
          rest_skus_failed: number | null
          rest_skus_priced: number | null
          run_date: string | null
          run_id: string | null
          scope: string | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          algolia_complete?: boolean | null
          algolia_hits_collected?: number | null
          algolia_hits_expected?: number | null
          duration_seconds?: never
          error_message?: string | null
          finished_at?: string | null
          rest_failed_skus?: string[] | null
          rest_skus_expected?: number | null
          rest_skus_failed?: number | null
          rest_skus_priced?: number | null
          run_date?: string | null
          run_id?: string | null
          scope?: string | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          algolia_complete?: boolean | null
          algolia_hits_collected?: number | null
          algolia_hits_expected?: number | null
          duration_seconds?: never
          error_message?: string | null
          finished_at?: string | null
          rest_failed_skus?: string[] | null
          rest_skus_expected?: number | null
          rest_skus_failed?: number | null
          rest_skus_priced?: number | null
          run_date?: string | null
          run_id?: string | null
          scope?: string | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      search_producers: {
        Args: { q: string }
        Returns: {
          n: number
          producer: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

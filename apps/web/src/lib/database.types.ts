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
      app_owners: {
        Row: {
          created_at: string
          singleton: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          singleton?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          singleton?: boolean
          user_id?: string
        }
        Relationships: []
      }
      bbr_holding_evidence: {
        Row: {
          alcohol_percent: number | null
          bbx_highest_bid_p: number | null
          bbx_last_transaction_price_p: number | null
          bbx_lowest_price_p: number | null
          bottle_volume_ml: number
          case_size: number
          colour: string | null
          country: string | null
          current_status: string | null
          description: string
          drinking_window_from: number | null
          drinking_window_to: number | null
          eligible_for_bbx: boolean
          format_code: string
          import_id: string
          livex_market_price_p: number | null
          maturity: string | null
          parent_sku: string
          product_code: string
          purchase_price_per_case_p: number | null
          quantity_bottles: number
          region: string | null
          source_row_number: number
          vintage: number | null
          wine_searcher_lowest_list_price_p: number | null
        }
        Insert: {
          alcohol_percent?: number | null
          bbx_highest_bid_p?: number | null
          bbx_last_transaction_price_p?: number | null
          bbx_lowest_price_p?: number | null
          bottle_volume_ml: number
          case_size: number
          colour?: string | null
          country?: string | null
          current_status?: string | null
          description: string
          drinking_window_from?: number | null
          drinking_window_to?: number | null
          eligible_for_bbx: boolean
          format_code: string
          import_id: string
          livex_market_price_p?: number | null
          maturity?: string | null
          parent_sku: string
          product_code: string
          purchase_price_per_case_p?: number | null
          quantity_bottles: number
          region?: string | null
          source_row_number: number
          vintage?: number | null
          wine_searcher_lowest_list_price_p?: number | null
        }
        Update: {
          alcohol_percent?: number | null
          bbx_highest_bid_p?: number | null
          bbx_last_transaction_price_p?: number | null
          bbx_lowest_price_p?: number | null
          bottle_volume_ml?: number
          case_size?: number
          colour?: string | null
          country?: string | null
          current_status?: string | null
          description?: string
          drinking_window_from?: number | null
          drinking_window_to?: number | null
          eligible_for_bbx?: boolean
          format_code?: string
          import_id?: string
          livex_market_price_p?: number | null
          maturity?: string | null
          parent_sku?: string
          product_code?: string
          purchase_price_per_case_p?: number | null
          quantity_bottles?: number
          region?: string | null
          source_row_number?: number
          vintage?: number | null
          wine_searcher_lowest_list_price_p?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bbr_holding_evidence_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellar_import_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "candidate_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "catalogue_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["parent_sku", "format_code"]
          },
        ]
      }
      bbx_fee_schedule: {
        Row: {
          effective_from: string
          recorded_at: string
          seller_commission_rate: number
          source_url: string
        }
        Insert: {
          effective_from: string
          recorded_at?: string
          seller_commission_rate: number
          source_url: string
        }
        Update: {
          effective_from?: string
          recorded_at?: string
          seller_commission_rate?: number
          source_url?: string
        }
        Relationships: []
      }
      cellar_import_rows: {
        Row: {
          format_code: string | null
          import_id: string
          match_status: string
          parent_sku: string | null
          raw_row: Json
          source_row_number: number
          validation_errors: Json
          validation_warnings: Json
        }
        Insert: {
          format_code?: string | null
          import_id: string
          match_status: string
          parent_sku?: string | null
          raw_row: Json
          source_row_number: number
          validation_errors?: Json
          validation_warnings?: Json
        }
        Update: {
          format_code?: string | null
          import_id?: string
          match_status?: string
          parent_sku?: string | null
          raw_row?: Json
          source_row_number?: number
          validation_errors?: Json
          validation_warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cellar_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cellar_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cellar_import_rows_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "candidate_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "cellar_import_rows_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "catalogue_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "cellar_import_rows_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["parent_sku", "format_code"]
          },
        ]
      }
      cellar_imports: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          byte_size: number
          content_checksum: string
          error_row_count: number
          failure_summary: string | null
          id: string
          matched_row_count: number
          original_filename: string
          parsed_row_count: number
          parser_version: string
          source_row_count: number
          source_type: string
          status: string
          storage_object_path: string
          unmatched_row_count: number
          uploaded_at: string
          uploaded_by: string
          warning_row_count: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          byte_size: number
          content_checksum: string
          error_row_count?: number
          failure_summary?: string | null
          id: string
          matched_row_count?: number
          original_filename: string
          parsed_row_count?: number
          parser_version: string
          source_row_count?: number
          source_type: string
          status: string
          storage_object_path: string
          unmatched_row_count?: number
          uploaded_at?: string
          uploaded_by: string
          warning_row_count?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          byte_size?: number
          content_checksum?: string
          error_row_count?: number
          failure_summary?: string | null
          id?: string
          matched_row_count?: number
          original_filename?: string
          parsed_row_count?: number
          parser_version?: string
          source_row_count?: number
          source_type?: string
          status?: string
          storage_object_path?: string
          unmatched_row_count?: number
          uploaded_at?: string
          uploaded_by?: string
          warning_row_count?: number
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
      release_offer_imports: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          byte_size: number
          content_checksum: string
          error_row_count: number
          failure_summary: string | null
          id: string
          imported_at: string
          imported_by: string
          original_filename: string
          parser_version: string
          priced_fragment_count: number
          source_row_count: number
          status: string
          storage_object_path: string
          warning_row_count: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          byte_size: number
          content_checksum: string
          error_row_count?: number
          failure_summary?: string | null
          id: string
          imported_at?: string
          imported_by: string
          original_filename: string
          parser_version: string
          priced_fragment_count?: number
          source_row_count?: number
          status?: string
          storage_object_path: string
          warning_row_count?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          byte_size?: number
          content_checksum?: string
          error_row_count?: number
          failure_summary?: string | null
          id?: string
          imported_at?: string
          imported_by?: string
          original_filename?: string
          parser_version?: string
          priced_fragment_count?: number
          source_row_count?: number
          status?: string
          storage_object_path?: string
          warning_row_count?: number
        }
        Relationships: []
      }
      release_offer_prices: {
        Row: {
          amount_p: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          currency: string
          format_code: string | null
          fragment_index: number
          id: number
          import_id: string
          parse_status: string
          price_fingerprint: string
          raw_price_text: string
          source_row_number: number
          tax_basis: string
          validation_warnings: Json
        }
        Insert: {
          amount_p?: number | null
          bottle_volume_ml?: number | null
          case_size?: number | null
          currency?: string
          format_code?: string | null
          fragment_index: number
          id?: number
          import_id: string
          parse_status: string
          price_fingerprint: string
          raw_price_text: string
          source_row_number: number
          tax_basis: string
          validation_warnings?: Json
        }
        Update: {
          amount_p?: number | null
          bottle_volume_ml?: number | null
          case_size?: number | null
          currency?: string
          format_code?: string | null
          fragment_index?: number
          id?: number
          import_id?: string
          parse_status?: string
          price_fingerprint?: string
          raw_price_text?: string
          source_row_number?: number
          tax_basis?: string
          validation_warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_prices_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: false
            referencedRelation: "release_offer_evidence_view"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "release_offer_prices_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: false
            referencedRelation: "release_offer_review_view"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "release_offer_prices_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: false
            referencedRelation: "release_offer_source_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
        ]
      }
      release_offer_product_resolutions: {
        Row: {
          import_id: string
          match_method: string | null
          parent_sku: string | null
          resolved_at: string
          resolved_by: string | null
          source_row_number: number
          status: string
        }
        Insert: {
          import_id: string
          match_method?: string | null
          parent_sku?: string | null
          resolved_at?: string
          resolved_by?: string | null
          source_row_number: number
          status: string
        }
        Update: {
          import_id?: string
          match_method?: string | null
          parent_sku?: string | null
          resolved_at?: string
          resolved_by?: string | null
          source_row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_product_resoluti_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "release_offer_evidence_view"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "release_offer_product_resoluti_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "release_offer_review_view"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "release_offer_product_resoluti_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "release_offer_source_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
        ]
      }
      release_offer_source_rows: {
        Row: {
          content_fingerprint: string
          description: string | null
          import_id: string
          offer_date: string
          raw_row: Json
          source_match_key: string
          source_message_id: string | null
          source_price_text: string
          source_product_id: string | null
          source_product_url: string | null
          source_row_number: number
          source_vintage: number | null
          source_wine: string
          tasting_notes: string | null
          validation_errors: Json
          validation_warnings: Json
        }
        Insert: {
          content_fingerprint: string
          description?: string | null
          import_id: string
          offer_date: string
          raw_row: Json
          source_match_key: string
          source_message_id?: string | null
          source_price_text: string
          source_product_id?: string | null
          source_product_url?: string | null
          source_row_number: number
          source_vintage?: number | null
          source_wine: string
          tasting_notes?: string | null
          validation_errors?: Json
          validation_warnings?: Json
        }
        Update: {
          content_fingerprint?: string
          description?: string | null
          import_id?: string
          offer_date?: string
          raw_row?: Json
          source_match_key?: string
          source_message_id?: string | null
          source_price_text?: string
          source_product_id?: string | null
          source_product_url?: string | null
          source_row_number?: number
          source_vintage?: number | null
          source_wine?: string
          tasting_notes?: string | null
          validation_errors?: Json
          validation_warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_source_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "release_offer_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      release_price_anchor_overrides: {
        Row: {
          confirmed_at: string
          confirmed_by: string
          format_code: string
          note: string | null
          parent_sku: string
          release_offer_price_id: number
        }
        Insert: {
          confirmed_at?: string
          confirmed_by: string
          format_code: string
          note?: string | null
          parent_sku: string
          release_offer_price_id: number
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string
          format_code?: string
          note?: string | null
          parent_sku?: string
          release_offer_price_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "release_price_anchor_overrides_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: true
            referencedRelation: "candidate_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: true
            referencedRelation: "catalogue_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: true
            referencedRelation: "skus"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_release_offer_price_id_fkey"
            columns: ["release_offer_price_id"]
            isOneToOne: true
            referencedRelation: "release_offer_evidence_view"
            referencedColumns: ["release_offer_price_id"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_release_offer_price_id_fkey"
            columns: ["release_offer_price_id"]
            isOneToOne: true
            referencedRelation: "release_offer_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_release_offer_price_id_fkey"
            columns: ["release_offer_price_id"]
            isOneToOne: true
            referencedRelation: "release_price_anchor_view"
            referencedColumns: ["release_offer_price_id"]
          },
          {
            foreignKeyName: "release_price_anchor_overrides_release_offer_price_id_fkey"
            columns: ["release_offer_price_id"]
            isOneToOne: true
            referencedRelation: "release_price_market_view"
            referencedColumns: ["release_offer_price_id"]
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
      bbr_cellar_market_view: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          catalogue_name: string | null
          colour: string | null
          confirmed_at: string | null
          country: string | null
          current_status: string | null
          description: string | null
          drinking_window_from: number | null
          drinking_window_to: number | null
          eligible_for_bbx: boolean | null
          format_code: string | null
          highest_bid_p: number | null
          import_id: string | null
          is_listed: boolean | null
          last_rest_checked_at: string | null
          lowest_ask_p: number | null
          market_price_p: number | null
          maturity: string | null
          parent_sku: string | null
          producer: string | null
          product_code: string | null
          product_url: string | null
          purchase_price_per_case_p: number | null
          quantity_bottles: number | null
          region: string | null
          source_row_number: number | null
          vintage: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bbr_holding_evidence_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellar_import_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "candidate_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "catalogue_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["parent_sku", "format_code"]
          },
        ]
      }
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
          is_listed: boolean | null
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
      current_bbr_holdings: {
        Row: {
          alcohol_percent: number | null
          bbx_highest_bid_p: number | null
          bbx_last_transaction_price_p: number | null
          bbx_lowest_price_p: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          confirmed_at: string | null
          country: string | null
          current_status: string | null
          description: string | null
          drinking_window_from: number | null
          drinking_window_to: number | null
          eligible_for_bbx: boolean | null
          format_code: string | null
          import_id: string | null
          livex_market_price_p: number | null
          maturity: string | null
          parent_sku: string | null
          product_code: string | null
          purchase_price_per_case_p: number | null
          quantity_bottles: number | null
          region: string | null
          source_row_number: number | null
          vintage: number | null
          wine_searcher_lowest_list_price_p: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bbr_holding_evidence_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellar_import_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "candidate_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "catalogue_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
          {
            foreignKeyName: "bbr_holding_evidence_parent_sku_format_code_fkey"
            columns: ["parent_sku", "format_code"]
            isOneToOne: false
            referencedRelation: "skus"
            referencedColumns: ["parent_sku", "format_code"]
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
      release_offer_evidence_view: {
        Row: {
          bottle_volume_ml: number | null
          case_size: number | null
          content_fingerprint: string | null
          duplicate_rank: number | null
          format_code: string | null
          import_id: string | null
          match_method: string | null
          offer_date: string | null
          parent_sku: string | null
          release_offer_price_id: number | null
          release_price_p: number | null
          source_message_id: string | null
          source_product_url: string | null
          source_row_number: number | null
          source_wine: string | null
          tax_basis: string | null
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_source_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "release_offer_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      release_offer_review_view: {
        Row: {
          import_id: string | null
          link_status: string | null
          match_method: string | null
          offer_date: string | null
          parent_sku: string | null
          price_fragment_count: number | null
          source_price_text: string | null
          source_product_id: string | null
          source_product_url: string | null
          source_row_number: number | null
          source_vintage: number | null
          source_wine: string | null
          valid_in_bond_fragment_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_source_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "release_offer_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      release_price_anchor_view: {
        Row: {
          anchor_status: string | null
          format_code: string | null
          offer_date: string | null
          parent_sku: string | null
          release_offer_price_id: number | null
          release_price_p: number | null
          source_product_url: string | null
          source_wine: string | null
        }
        Relationships: []
      }
      release_price_market_view: {
        Row: {
          anchor_status: string | null
          ask_vs_release_p: number | null
          ask_vs_release_pct: number | null
          bid_vs_release_p: number | null
          bid_vs_release_pct: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          format_code: string | null
          highest_bid_p: number | null
          is_listed: boolean | null
          last_rest_checked_at: string | null
          lowest_ask_p: number | null
          market_price_p: number | null
          name: string | null
          offer_date: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          recoup_bid_p: number | null
          region: string | null
          release_offer_price_id: number | null
          release_price_p: number | null
          seller_commission_rate: number | null
          seller_net_highest_bid_p: number | null
          source_product_url: string | null
          source_wine: string | null
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
      accept_bbr_import: { Args: { p_import_id: string }; Returns: Json }
      accept_release_offer_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      begin_release_offer_import: {
        Args: {
          p_byte_size: number
          p_content_checksum: string
          p_import_id: string
          p_original_filename: string
          p_parser_version: string
          p_storage_object_path: string
        }
        Returns: Json
      }
      clear_release_offer_product_resolution: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      confirm_release_price_anchor: {
        Args: { p_note?: string; p_release_offer_price_id: number }
        Returns: Json
      }
      delete_release_offer_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      ignore_release_offer_row: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      mark_release_offer_import_staged: {
        Args: {
          p_expected_price_fragments: number
          p_expected_source_rows: number
          p_import_id: string
        }
        Returns: Json
      }
      run_release_offer_matching: {
        Args: { p_import_id: string }
        Returns: Json
      }
      search_producers: {
        Args: { q: string }
        Returns: {
          n: number
          producer: string
        }[]
      }
      set_release_offer_product_resolution: {
        Args: {
          p_import_id: string
          p_parent_sku: string
          p_source_row_number: number
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stage_bbr_import: {
        Args: {
          p_byte_size: number
          p_content_checksum: string
          p_import_id: string
          p_original_filename: string
          p_parser_version: string
          p_rows: Json
          p_storage_object_path: string
        }
        Returns: Json
      }
      stage_release_offer_batch: {
        Args: { p_import_id: string; p_rows: Json }
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
    Enums: {},
  },
} as const


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
            referencedRelation: "wine_card_format_view"
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
            referencedRelation: "wine_card_format_view"
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
      cellartracker_evidence: {
        Row: {
          appellation: string | null
          begin_consume: number | null
          bottle_volume_ml: number
          colour: string | null
          country: string | null
          end_consume: number | null
          fully_consumed: boolean
          import_id: string
          match_group_key: string | null
          producer: string | null
          purchase_price_per_bottle_p: number | null
          quantity_bbr: number
          quantity_home: number
          region: string | null
          source_core_key: string | null
          source_match_key: string
          source_row_number: number
          source_wine: string
          total_quantity: number
          varietal: string | null
          vintage: number | null
        }
        Insert: {
          appellation?: string | null
          begin_consume?: number | null
          bottle_volume_ml: number
          colour?: string | null
          country?: string | null
          end_consume?: number | null
          fully_consumed: boolean
          import_id: string
          match_group_key?: string | null
          producer?: string | null
          purchase_price_per_bottle_p?: number | null
          quantity_bbr: number
          quantity_home: number
          region?: string | null
          source_core_key?: string | null
          source_match_key: string
          source_row_number: number
          source_wine: string
          total_quantity: number
          varietal?: string | null
          vintage?: number | null
        }
        Update: {
          appellation?: string | null
          begin_consume?: number | null
          bottle_volume_ml?: number
          colour?: string | null
          country?: string | null
          end_consume?: number | null
          fully_consumed?: boolean
          import_id?: string
          match_group_key?: string | null
          producer?: string | null
          purchase_price_per_bottle_p?: number | null
          quantity_bbr?: number
          quantity_home?: number
          region?: string | null
          source_core_key?: string | null
          source_match_key?: string
          source_row_number?: number
          source_wine?: string
          total_quantity?: number
          varietal?: string | null
          vintage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_evidence_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cellar_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cellartracker_evidence_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellar_import_rows"
            referencedColumns: ["import_id", "source_row_number"]
          },
        ]
      }
      cellartracker_match_run_groups: {
        Row: {
          error_message: string | null
          match_group_key: string
          processed_at: string | null
          run_id: string
          source_match_key: string
          source_producer: string | null
          source_region: string | null
          source_row_count: number
          source_vintage: number | null
          source_wine: string
          status: string
        }
        Insert: {
          error_message?: string | null
          match_group_key: string
          processed_at?: string | null
          run_id: string
          source_match_key: string
          source_producer?: string | null
          source_region?: string | null
          source_row_count: number
          source_vintage?: number | null
          source_wine: string
          status?: string
        }
        Update: {
          error_message?: string | null
          match_group_key?: string
          processed_at?: string | null
          run_id?: string
          source_match_key?: string
          source_producer?: string | null
          source_region?: string | null
          source_row_count?: number
          source_vintage?: number | null
          source_wine?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_match_run_groups_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "cellartracker_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cellartracker_match_runs: {
        Row: {
          algolia_exact_link_count: number
          algolia_observed_at: string | null
          algorithm_version: string
          catalogue_index: string
          error_group_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          local_exact_link_count: number
          processed_group_count: number
          remaining_group_count: number
          snapshot_import_id: string
          started_at: string
          started_by: string
          status: string
          total_group_count: number
        }
        Insert: {
          algolia_exact_link_count?: number
          algolia_observed_at?: string | null
          algorithm_version?: string
          catalogue_index?: string
          error_group_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          local_exact_link_count?: number
          processed_group_count?: number
          remaining_group_count?: number
          snapshot_import_id: string
          started_at?: string
          started_by: string
          status?: string
          total_group_count?: number
        }
        Update: {
          algolia_exact_link_count?: number
          algolia_observed_at?: string | null
          algorithm_version?: string
          catalogue_index?: string
          error_group_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          local_exact_link_count?: number
          processed_group_count?: number
          remaining_group_count?: number
          snapshot_import_id?: string
          started_at?: string
          started_by?: string
          status?: string
          total_group_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_match_runs_snapshot_import_id_fkey"
            columns: ["snapshot_import_id"]
            isOneToOne: false
            referencedRelation: "cellar_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      cellartracker_match_suggestions: {
        Row: {
          match_group_key: string
          match_score: number | null
          matched_words: string[]
          name: string
          observed_at: string
          parent_sku: string
          producer: string | null
          product_url: string | null
          purchase_mode: string | null
          rank: number
          region: string | null
          source_run_id: string
          stock_origin: string | null
          typo_count: number | null
          vintage: number | null
          was_biddable_at_observation: boolean
        }
        Insert: {
          match_group_key: string
          match_score?: number | null
          matched_words?: string[]
          name: string
          observed_at: string
          parent_sku: string
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank: number
          region?: string | null
          source_run_id: string
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
          was_biddable_at_observation: boolean
        }
        Update: {
          match_group_key?: string
          match_score?: number | null
          matched_words?: string[]
          name?: string
          observed_at?: string
          parent_sku?: string
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number
          region?: string | null
          source_run_id?: string
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
          was_biddable_at_observation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_match_suggestions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "cellartracker_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cellartracker_product_resolutions: {
        Row: {
          import_id: string
          match_method: string
          match_run_id: string | null
          parent_sku: string | null
          resolved_at: string
          resolved_by: string | null
          source_row_number: number
          status: string
        }
        Insert: {
          import_id: string
          match_method: string
          match_run_id?: string | null
          parent_sku?: string | null
          resolved_at?: string
          resolved_by?: string | null
          source_row_number: number
          status: string
        }
        Update: {
          import_id?: string
          match_method?: string
          match_run_id?: string | null
          parent_sku?: string | null
          resolved_at?: string
          resolved_by?: string | null
          source_row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_product_resoluti_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellartracker_evidence"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "cellartracker_product_resoluti_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "current_cellartracker_records"
            referencedColumns: ["import_id", "source_row_number"]
          },
          {
            foreignKeyName: "cellartracker_product_resolutions_match_run_id_fkey"
            columns: ["match_run_id"]
            isOneToOne: false
            referencedRelation: "cellartracker_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cellartracker_record_decisions: {
        Row: {
          decided_at: string
          decided_by: string | null
          excluded_at: string | null
          is_excluded: boolean
          link_status: string | null
          match_group_key: string
          match_method: string | null
          parent_sku: string | null
          purchase_price_per_bottle_p: number | null
          source_price_per_bottle_p: number | null
          source_wine: string
        }
        Insert: {
          decided_at?: string
          decided_by?: string | null
          excluded_at?: string | null
          is_excluded?: boolean
          link_status?: string | null
          match_group_key: string
          match_method?: string | null
          parent_sku?: string | null
          purchase_price_per_bottle_p?: number | null
          source_price_per_bottle_p?: number | null
          source_wine: string
        }
        Update: {
          decided_at?: string
          decided_by?: string | null
          excluded_at?: string | null
          is_excluded?: boolean
          link_status?: string | null
          match_group_key?: string
          match_method?: string | null
          parent_sku?: string | null
          purchase_price_per_bottle_p?: number | null
          source_price_per_bottle_p?: number | null
          source_wine?: string
        }
        Relationships: []
      }
      cellartracker_resolution_events: {
        Row: {
          changed_at: string
          changed_by: string | null
          event_type: string
          id: number
          import_id: string
          parent_sku: string | null
          previous_parent_sku: string | null
          source_row_number: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          event_type: string
          id?: never
          import_id: string
          parent_sku?: string | null
          previous_parent_sku?: string | null
          source_row_number: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          event_type?: string
          id?: never
          import_id?: string
          parent_sku?: string | null
          previous_parent_sku?: string | null
          source_row_number?: number
        }
        Relationships: []
      }
      pending_favourites: {
        Row: {
          created_at: string
          match_group_key: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          match_group_key: string
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          match_group_key?: string
          source?: string
          user_id?: string
        }
        Relationships: []
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
      release_offer_match_run_groups: {
        Row: {
          error_message: string | null
          match_group_key: string
          processed_at: string | null
          run_id: string
          source_match_key: string
          source_row_count: number
          source_vintage: number | null
          source_wine: string
          status: string
        }
        Insert: {
          error_message?: string | null
          match_group_key: string
          processed_at?: string | null
          run_id: string
          source_match_key: string
          source_row_count: number
          source_vintage?: number | null
          source_wine: string
          status?: string
        }
        Update: {
          error_message?: string | null
          match_group_key?: string
          processed_at?: string | null
          run_id?: string
          source_match_key?: string
          source_row_count?: number
          source_vintage?: number | null
          source_wine?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_match_run_groups_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "release_offer_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      release_offer_match_runs: {
        Row: {
          algolia_exact_link_count: number
          algolia_observed_at: string | null
          algorithm_version: string
          catalogue_index: string
          error_group_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          local_exact_link_count: number
          processed_group_count: number
          remaining_group_count: number
          started_at: string
          started_by: string
          status: string
          supplied_id_link_count: number
          total_group_count: number
        }
        Insert: {
          algolia_exact_link_count?: number
          algolia_observed_at?: string | null
          algorithm_version?: string
          catalogue_index?: string
          error_group_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          local_exact_link_count?: number
          processed_group_count?: number
          remaining_group_count?: number
          started_at?: string
          started_by: string
          status?: string
          supplied_id_link_count?: number
          total_group_count?: number
        }
        Update: {
          algolia_exact_link_count?: number
          algolia_observed_at?: string | null
          algorithm_version?: string
          catalogue_index?: string
          error_group_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          local_exact_link_count?: number
          processed_group_count?: number
          remaining_group_count?: number
          started_at?: string
          started_by?: string
          status?: string
          supplied_id_link_count?: number
          total_group_count?: number
        }
        Relationships: []
      }
      release_offer_match_suggestions: {
        Row: {
          match_group_key: string
          match_score: number | null
          matched_words: string[]
          name: string
          observed_at: string
          parent_sku: string
          producer: string | null
          product_url: string | null
          purchase_mode: string | null
          rank: number
          region: string | null
          source_run_id: string
          stock_origin: string | null
          typo_count: number | null
          vintage: number | null
          was_biddable_at_observation: boolean
        }
        Insert: {
          match_group_key: string
          match_score?: number | null
          matched_words?: string[]
          name: string
          observed_at: string
          parent_sku: string
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank: number
          region?: string | null
          source_run_id: string
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
          was_biddable_at_observation: boolean
        }
        Update: {
          match_group_key?: string
          match_score?: number | null
          matched_words?: string[]
          name?: string
          observed_at?: string
          parent_sku?: string
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number
          region?: string | null
          source_run_id?: string
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
          was_biddable_at_observation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_match_suggestions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "release_offer_match_runs"
            referencedColumns: ["id"]
          },
        ]
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
          match_run_id: string | null
          parent_sku: string | null
          resolved_at: string
          resolved_by: string | null
          source_row_number: number
          status: string
        }
        Insert: {
          import_id: string
          match_method?: string | null
          match_run_id?: string | null
          parent_sku?: string | null
          resolved_at?: string
          resolved_by?: string | null
          source_row_number: number
          status: string
        }
        Update: {
          import_id?: string
          match_method?: string | null
          match_run_id?: string | null
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
          {
            foreignKeyName: "release_offer_product_resolutions_match_run_id_fkey"
            columns: ["match_run_id"]
            isOneToOne: false
            referencedRelation: "release_offer_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      release_offer_record_exclusions: {
        Row: {
          content_fingerprint: string
          excluded_at: string
          excluded_by: string | null
          match_group_key: string | null
          offer_date: string | null
          source_wine: string | null
        }
        Insert: {
          content_fingerprint: string
          excluded_at?: string
          excluded_by?: string | null
          match_group_key?: string | null
          offer_date?: string | null
          source_wine?: string | null
        }
        Update: {
          content_fingerprint?: string
          excluded_at?: string
          excluded_by?: string | null
          match_group_key?: string | null
          offer_date?: string | null
          source_wine?: string | null
        }
        Relationships: []
      }
      release_offer_resolution_events: {
        Row: {
          changed_at: string
          changed_by: string | null
          event_type: string
          id: number
          import_id: string
          match_run_id: string | null
          new_match_method: string | null
          new_parent_sku: string | null
          new_status: string | null
          previous_match_method: string | null
          previous_parent_sku: string | null
          previous_status: string | null
          source_row_number: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          event_type: string
          id?: number
          import_id: string
          match_run_id?: string | null
          new_match_method?: string | null
          new_parent_sku?: string | null
          new_status?: string | null
          previous_match_method?: string | null
          previous_parent_sku?: string | null
          previous_status?: string | null
          source_row_number: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          event_type?: string
          id?: number
          import_id?: string
          match_run_id?: string | null
          new_match_method?: string | null
          new_parent_sku?: string | null
          new_status?: string | null
          previous_match_method?: string | null
          previous_parent_sku?: string | null
          previous_status?: string | null
          source_row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_resolution_events_match_run_id_fkey"
            columns: ["match_run_id"]
            isOneToOne: false
            referencedRelation: "release_offer_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      release_offer_source_rows: {
        Row: {
          content_fingerprint: string
          description: string | null
          import_id: string
          match_group_key: string | null
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
          match_group_key?: string | null
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
          match_group_key?: string | null
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
            referencedRelation: "wine_card_format_view"
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
      wine_favourites: {
        Row: {
          created_at: string
          parent_sku: string
          user_id: string
        }
        Insert: {
          created_at?: string
          parent_sku: string
          user_id: string
        }
        Update: {
          created_at?: string
          parent_sku?: string
          user_id?: string
        }
        Relationships: []
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
            referencedRelation: "wine_card_format_view"
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
        Relationships: []
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
        Relationships: []
      }
      cellartracker_excluded_record_view: {
        Row: {
          excluded_at: string | null
          in_current_snapshot: boolean | null
          link_status: string | null
          match_group_key: string | null
          parent_sku: string | null
          source_wine: string | null
          vintage: number | null
        }
        Relationships: []
      }
      cellartracker_match_review_view: {
        Row: {
          is_biddable: boolean | null
          linked_row_count: number | null
          match_group_key: string | null
          match_method: string | null
          parent_sku: string | null
          source_producer: string | null
          source_region: string | null
          source_row_count: number | null
          source_vintage: number | null
          source_wine: string | null
          suggestion_count: number | null
          suggestions_observed_at: string | null
          suppressed_row_count: number | null
          unresolved_row_count: number | null
        }
        Relationships: []
      }
      cellartracker_match_suggestion_view: {
        Row: {
          is_biddable: boolean | null
          match_group_key: string | null
          match_score: number | null
          matched_words: string[] | null
          name: string | null
          observed_at: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          purchase_mode: string | null
          rank: number | null
          region: string | null
          source_run_id: string | null
          stock_origin: string | null
          typo_count: number | null
          vintage: number | null
        }
        Insert: {
          is_biddable?: never
          match_group_key?: string | null
          match_score?: number | null
          matched_words?: string[] | null
          name?: string | null
          observed_at?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number | null
          region?: string | null
          source_run_id?: string | null
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
        }
        Update: {
          is_biddable?: never
          match_group_key?: string | null
          match_score?: number | null
          matched_words?: string[] | null
          name?: string | null
          observed_at?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number | null
          region?: string | null
          source_run_id?: string | null
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_match_suggestions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "cellartracker_match_runs"
            referencedColumns: ["id"]
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
            referencedRelation: "wine_card_format_view"
            referencedColumns: ["parent_sku", "format_code"]
          },
        ]
      }
      current_cellartracker_records: {
        Row: {
          accepted_at: string | null
          appellation: string | null
          begin_consume: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          colour: string | null
          country: string | null
          end_consume: number | null
          fully_consumed: boolean | null
          highest_bid_per_bottle_p: number | null
          import_id: string | null
          is_listed: boolean | null
          link_status: string | null
          lowest_ask_per_bottle_p: number | null
          match_group_key: string | null
          match_method: string | null
          parent_sku: string | null
          producer: string | null
          purchase_price_per_bottle_p: number | null
          quantity_bbr: number | null
          quantity_home: number | null
          region: string | null
          source_match_key: string | null
          source_row_number: number | null
          source_wine: string | null
          total_quantity: number | null
          varietal: string | null
          vintage: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cellartracker_evidence_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cellar_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cellartracker_evidence_import_id_source_row_number_fkey"
            columns: ["import_id", "source_row_number"]
            isOneToOne: true
            referencedRelation: "cellar_import_rows"
            referencedColumns: ["import_id", "source_row_number"]
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
      favourite_wine_view: {
        Row: {
          adjusted_guide_per_bottle_p: number | null
          anchor_status: string | null
          ask_vs_release_pct: number | null
          bbr_cellar_bottles: number | null
          bbr_cellar_holding_count: number | null
          bid_vs_release_pct: number | null
          cellartracker_bottles_bbr: number | null
          cellartracker_bottles_home: number | null
          cellartracker_paid_per_bottle_p: number | null
          cellartracker_record_count: number | null
          colour: string | null
          country: string | null
          favourited_at: string | null
          format_count: number | null
          guide_per_bottle_p: number | null
          highest_bid_per_bottle_p: number | null
          in_tracked_catalogue: boolean | null
          latest_release_offer_date: string | null
          latest_release_price_per_bottle_p: number | null
          listed_format_count: number | null
          lowest_ask_per_bottle_p: number | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          region: string | null
          release_offer_record_count: number | null
          subregion: string | null
          user_id: string | null
          vintage: number | null
          wine_name: string | null
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
      pending_favourite_view: {
        Row: {
          bottles: number | null
          favourited_at: string | null
          is_stale: boolean | null
          latest_offer_date: string | null
          match_group_key: string | null
          producer: string | null
          record_count: number | null
          source: string | null
          source_wine: string | null
          suggestion_count: number | null
          user_id: string | null
          vintage: number | null
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
        Relationships: []
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
          tasting_notes: string | null
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
      release_offer_excluded_record_view: {
        Row: {
          content_fingerprint: string | null
          excluded_at: string | null
          in_accepted_evidence: boolean | null
          match_group_key: string | null
          offer_date: string | null
          source_wine: string | null
        }
        Insert: {
          content_fingerprint?: string | null
          excluded_at?: string | null
          in_accepted_evidence?: never
          match_group_key?: string | null
          offer_date?: string | null
          source_wine?: string | null
        }
        Update: {
          content_fingerprint?: string | null
          excluded_at?: string | null
          in_accepted_evidence?: never
          match_group_key?: string | null
          offer_date?: string | null
          source_wine?: string | null
        }
        Relationships: []
      }
      release_offer_match_review_view: {
        Row: {
          earliest_offer_date: string | null
          is_biddable: boolean | null
          latest_offer_date: string | null
          linked_row_count: number | null
          match_group_key: string | null
          match_method: string | null
          parent_sku: string | null
          source_row_count: number | null
          source_vintage: number | null
          source_wine: string | null
          suggestion_count: number | null
          suggestions_observed_at: string | null
          suppressed_row_count: number | null
          unresolved_row_count: number | null
        }
        Relationships: []
      }
      release_offer_match_suggestion_view: {
        Row: {
          is_biddable: boolean | null
          match_group_key: string | null
          match_score: number | null
          matched_words: string[] | null
          name: string | null
          observed_at: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          purchase_mode: string | null
          rank: number | null
          region: string | null
          source_run_id: string | null
          stock_origin: string | null
          typo_count: number | null
          vintage: number | null
        }
        Insert: {
          is_biddable?: never
          match_group_key?: string | null
          match_score?: number | null
          matched_words?: string[] | null
          name?: string | null
          observed_at?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number | null
          region?: string | null
          source_run_id?: string | null
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
        }
        Update: {
          is_biddable?: never
          match_group_key?: string | null
          match_score?: number | null
          matched_words?: string[] | null
          name?: string | null
          observed_at?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          purchase_mode?: string | null
          rank?: number | null
          region?: string | null
          source_run_id?: string | null
          stock_origin?: string | null
          typo_count?: number | null
          vintage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "release_offer_match_suggestions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "release_offer_match_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      release_offer_review_view: {
        Row: {
          import_id: string | null
          link_status: string | null
          match_group_key: string | null
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
      wine_card_format_view: {
        Row: {
          adjusted_guide_p: number | null
          anchor_status: string | null
          ask_vs_release_p: number | null
          ask_vs_release_pct: number | null
          bid_vs_release_p: number | null
          bid_vs_release_pct: number | null
          bottle_volume_ml: number | null
          case_size: number | null
          format_code: string | null
          highest_bid_p: number | null
          is_listed: boolean | null
          last_rest_checked_at: string | null
          last_transaction_p: number | null
          lowest_ask_p: number | null
          market_price_p: number | null
          parent_sku: string | null
          price_vs_last_pct: number | null
          price_vs_market_pct: number | null
          release_offer_date: string | null
          release_price_p: number | null
          wine_ref: string | null
        }
        Relationships: []
      }
      wine_card_view: {
        Row: {
          colour: string | null
          country: string | null
          is_biddable: boolean | null
          name: string | null
          parent_sku: string | null
          producer: string | null
          product_url: string | null
          region: string | null
          subregion: string | null
          vintage: number | null
          wine_ref: string | null
        }
        Insert: {
          colour?: string | null
          country?: string | null
          is_biddable?: never
          name?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
          wine_ref?: never
        }
        Update: {
          colour?: string | null
          country?: string | null
          is_biddable?: never
          name?: string | null
          parent_sku?: string | null
          producer?: string | null
          product_url?: string | null
          region?: string | null
          subregion?: string | null
          vintage?: number | null
          wine_ref?: never
        }
        Relationships: []
      }
    }
    Functions: {
      accept_bbr_import: { Args: { p_import_id: string }; Returns: Json }
      accept_cellartracker_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      accept_release_offer_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      begin_cellartracker_match_run: { Args: never; Returns: Json }
      begin_cellartracker_matching: { Args: never; Returns: Json }
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
      begin_release_offer_match_run: { Args: never; Returns: Json }
      clear_release_offer_product_resolution: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      confirm_cellartracker_match_group: {
        Args: {
          p_match_group_key: string
          p_method?: string
          p_parent_sku: string
        }
        Returns: Json
      }
      confirm_release_offer_match_group: {
        Args: {
          p_match_group_key: string
          p_method?: string
          p_parent_sku: string
        }
        Returns: Json
      }
      confirm_release_price_anchor: {
        Args: { p_note?: string; p_release_offer_price_id: number }
        Returns: Json
      }
      delete_cellartracker_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      delete_release_offer_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      discard_cellartracker_import_row: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      edit_cellartracker_match_group: {
        Args: { p_match_group_key: string; p_parent_sku: string }
        Returns: Json
      }
      edit_release_offer_match_group: {
        Args: { p_match_group_key: string; p_parent_sku: string }
        Returns: Json
      }
      exclude_cellartracker_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      exclude_cellartracker_record: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      exclude_release_offer_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      exclude_release_offer_record: {
        Args: { p_import_id: string; p_source_row_number: number }
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
      preview_cellartracker_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      record_cellartracker_algolia_error: {
        Args: {
          p_error_message: string
          p_match_group_key: string
          p_run_id: string
        }
        Returns: Json
      }
      record_cellartracker_algolia_result: {
        Args: {
          p_auto_link_parent_sku: string
          p_candidates: Json
          p_match_group_key: string
          p_observed_at: string
          p_run_id: string
        }
        Returns: Json
      }
      record_release_offer_algolia_error: {
        Args: {
          p_error_message: string
          p_match_group_key: string
          p_run_id: string
        }
        Returns: Json
      }
      record_release_offer_algolia_result: {
        Args: {
          p_candidates: Json
          p_exact_parent_skus: string[]
          p_exhaustive: boolean
          p_match_group_key: string
          p_observed_at: string
          p_run_id: string
        }
        Returns: Json
      }
      repair_cellartracker_import_price: {
        Args: {
          p_import_id: string
          p_price_p: number
          p_source_row_number: number
        }
        Returns: Json
      }
      repair_cellartracker_import_row: {
        Args: {
          p_import_id: string
          p_raw_row: Json
          p_source_row_number: number
        }
        Returns: Json
      }
      restore_cellartracker_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      restore_cellartracker_record: {
        Args: { p_match_group_key: string; p_source_wine: string }
        Returns: Json
      }
      restore_release_offer_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      restore_release_offer_record: {
        Args: { p_content_fingerprint: string }
        Returns: Json
      }
      search_producers: {
        Args: { q: string }
        Returns: {
          n: number
          producer: string
        }[]
      }
      set_cellartracker_product_resolution: {
        Args: {
          p_import_id: string
          p_method?: string
          p_parent_sku: string
          p_source_row_number: number
        }
        Returns: Json
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
      stage_cellartracker_import: {
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
      suppress_cellartracker_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      suppress_release_offer_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      unlink_cellartracker_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      unlink_cellartracker_product_resolution: {
        Args: { p_import_id: string; p_source_row_number: number }
        Returns: Json
      }
      unlink_release_offer_match_group: {
        Args: { p_match_group_key: string }
        Returns: Json
      }
      update_cellartracker_record_price: {
        Args: {
          p_import_id: string
          p_price_p: number
          p_source_row_number: number
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

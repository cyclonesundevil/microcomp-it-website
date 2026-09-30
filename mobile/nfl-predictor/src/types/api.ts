export type ModelId =
  | "baseline"
  | "enhanced"
  | "market_blend"
  | "mean_reversion"
  | "rothstein"
  | "rothstein_plus"
  | "rsm_stage7c"
  | string;

export type CacheMetadata = {
  exists?: boolean;
  stale?: boolean;
  age_seconds?: number | null;
  last_updated_utc?: string | null;
  [key: string]: unknown;
};

export type MarketFavorite = {
  team: string | null;
  spread: number;
  home_margin: number;
  basis: string;
};

export type MarketInfo = {
  spread_line: number | null;
  total_line: number | null;
  favorite: MarketFavorite | null;
};

export type MobileAlgorithmPrediction = {
  model: ModelId;
  status_label: "Market baseline" | "Production" | "Experimental" | "Research only" | string;
  eligible: boolean | null;
  display_suppressed: boolean;
  predicted_home_margin: number | null;
  predicted_total: number | null;
  market_favorite_relative_spread: number | null;
  spread_edge: number | null;
  total_edge: number | null;
  availability_adjusted: boolean;
  notes: string[];
};

export type ModelSignals = {
  schema_version?: number;
  disclaimer?: string;
  agreement_label?: string;
  market_alignment_label?: string;
  total_outlook_label?: string;
  opportunity_label?: string;
  opportunity_tier?: "high" | "moderate" | "low" | "none" | string;
  opportunity_score?: number;
  model_spread_range?: number | null;
  model_total_range?: number | null;
  max_spread_market_gap?: number | null;
  max_total_market_gap?: number | null;
  models_favoring_market_favorite?: number;
  models_favoring_market_underdog?: number;
  models_without_output?: number;
  model_count?: number;
  story?: string;
  [key: string]: unknown;
};

export type UpcomingGame = {
  game_id: string | null;
  season: number | null;
  week: number | null;
  football_week_start: string | null;
  game_status: "scheduled" | "final" | string;
  kickoff_date: string | null;
  kickoff_time: string | null;
  away_team: string | null;
  home_team: string | null;
  away_score: number | null;
  home_score: number | null;
  market: MarketInfo;
  algorithms: Record<ModelId, MobileAlgorithmPrediction>;
  model_signals: ModelSignals | null;
};

export type MobileUpcomingResponse = {
  success: boolean;
  api_version: string;
  client_contract: string;
  source: string;
  cache: CacheMetadata;
  cache_hit?: boolean;
  ready?: boolean;
  status?: string;
  message?: string;
  season: number | null;
  week: number | null;
  football_week_start: string | null;
  generated_at: string | null;
  last_rebuild_at: string | null;
  cache_age_seconds?: number | null;
  cache_ttl_seconds?: number | null;
  model_status_labels: Record<string, string>;
  games: UpcomingGame[];
  model_signals_note?: string;
  error?: string;
};

export type MobileModelSignalsResponse = {
  success: boolean;
  api_version: string;
  client_contract: string;
  source: string;
  cache: CacheMetadata;
  cache_hit?: boolean;
  ready?: boolean;
  status?: string;
  season: number | null;
  week: number | null;
  football_week_start: string | null;
  last_rebuild_at: string | null;
  model_status_labels: Record<string, string>;
  disclaimer: string;
  games: Array<{
    game_id: string | null;
    season: number | null;
    week: number | null;
    football_week_start: string | null;
    game_status: string;
    kickoff_date: string | null;
    kickoff_time: string | null;
    away_team: string | null;
    home_team: string | null;
    market: MarketInfo;
    model_signals: ModelSignals | null;
  }>;
  error?: string;
};

export type WeeklyModelPerformance = {
  model: ModelId;
  completed_games: number;
  spread_wins: number;
  spread_losses: number;
  spread_pushes: number;
  spread_bets: number;
  spread_win_rate: number | null;
  total_wins: number;
  total_losses: number;
  total_pushes: number;
  total_bets: number;
  total_win_rate: number | null;
  spread_mae: number | null;
  total_score_mae: number | null;
};

export type MobileWeeklyPerformanceResponse = {
  success: boolean;
  api_version: string;
  client_contract: string;
  source: string;
  cache: CacheMetadata;
  cache_hit?: boolean;
  performance: {
    season: number;
    week: number;
    completed_games: number;
    generated_at: string | null;
    models: WeeklyModelPerformance[];
  };
  error?: string;
};

export type PerformanceTrendWeek = Omit<WeeklyModelPerformance, "model"> & {
  week: number;
};

export type MobileAlgorithmPerformanceResponse = {
  success: boolean;
  api_version: string;
  client_contract: string;
  source: string;
  cache: CacheMetadata;
  cache_hit?: boolean;
  trend: {
    season: number;
    model: ModelId;
    generated_at: string | null;
    weeks: PerformanceTrendWeek[];
  };
  error?: string;
};

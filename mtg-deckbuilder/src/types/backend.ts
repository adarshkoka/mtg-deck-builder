// TypeScript versions of the backend's response models (the Pydantic models in server/app).
// Keeping them in one file makes it obvious when the API contract changes.

export type ColorLetter = 'W' | 'U' | 'B' | 'R' | 'G';

// One printing the user owns (server: app/collection/queries.py OwnedCard).
export interface OwnedCard {
  scryfall_id: string;
  oracle_id: string | null;
  name: string;
  quantity: number;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power: string | null;
  toughness: string | null;
  rarity: string;
  set_code: string;
  collector_number: string;
  legal_in_commander: boolean;
  image_url: string | null;
  image_url_small: string | null;
  price_usd: string | null;
  multiverse_ids: number[];
}

export interface CollectionSummary {
  id: number;
  name: string;
  created_at: string;
  unique_cards: number;
  total_cards: number;
}

// Filters for GET /collections/{id}/cards. Every field is optional.
export interface CardFilters {
  name?: string;
  text?: string;
  type_line?: string;
  identity_within?: string[];
  min_cmc?: number;
  max_cmc?: number;
  commander_legal?: boolean;
}

export interface OwnedCardsPage {
  total: number;
  limit: number;
  offset: number;
  cards: OwnedCard[];
}

export interface RowError {
  line: number;
  message: string;
}

export interface ImportAccepted {
  job_id: string;
  collection_id: number;
  source_format: string;
  rows_accepted: number;
  row_errors: RowError[];
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ImportStatus {
  job_id: string;
  collection_id: number;
  status: JobStatus;
  batches_done: number;
  batches_total: number;
  unique_cards: number;
  row_errors: RowError[];
  not_found: { line: number; name: string }[];
  error: string | null;
  finished_at: string | null;
}

export interface EmbeddingStatus {
  collection_id: number;
  coverage: number; // 0-1: how much of the collection semantic search can see
  queued: boolean;
}

export interface SynergyCard {
  card: OwnedCard;
  score: number;
  matched_by: ('meaning' | 'keywords')[];
}

export interface SynergyResult {
  query: string;
  semantic: boolean;
  cards: SynergyCard[];
}

// The deck view's "AI Analysis" panel (GET /analyzeCards).
export interface AnalyzedCard {
  name: string;
  type_line: string;
  mana_cost: string;
  error?: string;
}

export interface CardAnalysis {
  cards: AnalyzedCard[];
  formatted_prompt: string;
  ai_analysis: string;
  total_requested: number;
  total_found: number;
}

// --- Deck building ----------------------------------------------------------------------

export type Role =
  | 'ramp'
  | 'card_draw'
  | 'removal'
  | 'board_wipe'
  | 'synergy'
  | 'win_condition'
  | 'protection'
  | 'land'
  | 'utility';

export const ROLE_LABELS: Record<Role, string> = {
  ramp: 'Ramp',
  card_draw: 'Card draw',
  removal: 'Removal',
  board_wipe: 'Board wipes',
  synergy: 'Synergy',
  win_condition: 'Win conditions',
  protection: 'Protection',
  land: 'Lands',
  utility: 'Utility',
};

export interface CardPick {
  name: string;
  role: Role;
  reason: string;
}

export interface SuggestedBuy {
  name: string;
  reason: string;
  price_usd: string | null;
  scryfall_uri: string | null;
}

export interface DeckRecommendation {
  commander: string;
  picks: CardPick[];
  basic_lands: Record<string, number>;
  suggested_buys: SuggestedBuy[];
  summary: string;
}

export interface DeckRequest {
  collection_id: number;
  commander: string;
  must_include: string[];
  notes: string | null;
  previous: DeckRecommendation | null;
  accepted: string[];
  rejected: string[];
  feedback: string | null;
}

// One step of an agent run: a model call or a tool call (server: app/agent/loop.py).
export interface TraceStep {
  step: number;
  kind: 'model' | 'tool';
  name: string;
  duration_ms: number;
  input: unknown;
  output: unknown;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
}

export interface AgentRun {
  run_id: string;
  parent_run_id: string | null;
  collection_id: number;
  status: JobStatus;
  engine: string;
  model: string;
  request: DeckRequest;
  trace: TraceStep[];
  result: DeckRecommendation | null;
  error: string | null;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  finished_at: string | null;
}

export interface SavedDeck {
  id: number;
  collection_id: number;
  name: string;
  commander: string;
  cards: CardPick[];
  basic_lands: Record<string, number>;
  source_run_id: string | null;
  created_at: string;
  card_count: number;
  complete: boolean;
}

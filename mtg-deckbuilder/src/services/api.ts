// A small typed client for the backend. Every request goes through `request()`, which
// adds the API key header and turns error responses into ApiError with a readable message.

import { API_KEY, API_URL } from '../config';
import type {
  AgentRun,
  CardAnalysis,
  CardFilters,
  CardPick,
  CollectionSummary,
  EmbeddingStatus,
  ImportAccepted,
  ImportStatus,
  OwnedCard,
  OwnedCardsPage,
  SavedDeck,
  SynergyResult,
} from '../types/backend';
import type { ScryfallCard } from '../types/deck';

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// FastAPI puts error information in `detail`: a string, a list of validation errors, or
// (for our 422s) an object with a message and a list of problems.
function messageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('detail' in body)) return fallback;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === 'object' && d && 'msg' in d ? String(d.msg) : String(d))).join('; ');
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const { message, problems } = detail as { message: string; problems?: string[] };
    return problems?.length ? `${message}: ${problems.join('; ')}` : message;
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-API-Key', API_KEY);
  // Let the browser set the multipart boundary itself for file uploads.
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(body, `HTTP ${response.status}`), body);
  }
  return body as T;
}

// Builds "?a=1&b=x&b=y" from an object, skipping empty values and repeating array keys
// (FastAPI reads repeated keys as a list).
function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  // --- Collections ---
  listCollections: () => request<CollectionSummary[]>('/collections'),

  importCollection: (file: File, name: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    return request<ImportAccepted>('/collections/import', { method: 'POST', body: form });
  },

  importStatus: (jobId: string) => request<ImportStatus>(`/collections/imports/${jobId}`),

  deleteCollection: (id: number) => request<void>(`/collections/${id}`, { method: 'DELETE' }),

  searchCards: (id: number, filters: CardFilters, limit = 60, offset = 0) => {
    // An empty identity list means "colorless only" to the server, so send it explicitly.
    const identity = filters.identity_within;
    const params = { ...filters, identity_within: identity?.length === 0 ? [''] : identity, limit, offset };
    return request<OwnedCardsPage>(`/collections/${id}/cards${query(params)}`);
  },

  commanders: (id: number) => request<OwnedCard[]>(`/collections/${id}/commanders`),

  lookupCards: (id: number, names: string[]) =>
    request<OwnedCard[]>(`/collections/${id}/cards/lookup`, json({ names })),

  synergy: (id: number, commander: string, theme?: string) =>
    request<SynergyResult>(`/collections/${id}/synergy${query({ commander, theme, limit: 40 })}`),

  embeddingStatus: (id: number) => request<EmbeddingStatus>(`/collections/${id}/embeddings`),

  startEmbedding: (id: number) => request<EmbeddingStatus>(`/collections/${id}/embeddings`, { method: 'POST' }),

  // --- AI deck building ---
  buildDeck: (body: { collection_id: number; commander: string; must_include: string[]; notes: string | null }) =>
    request<{ run_id: string }>('/decks/build', json(body)),

  getRun: (runId: string) => request<AgentRun>(`/decks/runs/${runId}`),

  listRuns: (collectionId: number) =>
    request<AgentRun[]>(`/decks/runs${query({ collection_id: collectionId, limit: 30 })}`),

  reviseRun: (runId: string, body: { accepted: string[]; rejected: string[]; feedback: string | null }) =>
    request<{ run_id: string }>(`/decks/runs/${runId}/revise`, json(body)),

  // Written analysis of up to 20 cards (the deck view's "AI Analysis" panel).
  analyzeCards: (multiverseIds: number[]) =>
    request<CardAnalysis>(`/analyzeCards${query({ multiverse_ids: multiverseIds.join(',') })}`),

  // --- Saved decks ---
  saveDeck: (body: {
    collection_id: number;
    name: string;
    commander: string;
    cards: CardPick[];
    basic_lands: Record<string, number>;
    source_run_id: string | null;
  }) => request<SavedDeck>('/decks', json(body)),

  listDecks: (collectionId: number) => request<SavedDeck[]>(`/decks${query({ collection_id: collectionId })}`),

  deleteDeck: (id: number) => request<void>(`/decks/${id}`, { method: 'DELETE' }),
};

const MAX_ANALYZED_CARDS = 20; // the /analyzeCards limit, which keeps the prompt small

// The deck view's "AI Analysis" panel: a written analysis of up to 20 of the deck's cards.
// (Deck *building* uses the agent instead; see components/AgentBuilder.tsx.)
export async function analyzeDeckCards(cards: Map<string, ScryfallCard>): Promise<CardAnalysis> {
  // The endpoint looks cards up by multiverse id; digital-only cards don't have one.
  const ids = [...cards.values()]
    .map((card) => card.multiverse_ids?.[0])
    .filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) {
    throw new Error('None of these cards have a multiverse id, so they cannot be analyzed.');
  }
  return api.analyzeCards(ids.slice(0, MAX_ANALYZED_CARDS));
}

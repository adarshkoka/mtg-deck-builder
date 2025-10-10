import type { MTGJSONCard } from '../types/mtgjson';
import type { ScryfallCard } from '../types/scryfall';
import { SERVER_API_URL } from '../constants';

// Response types for FastAPI endpoints
interface FastAPICardResponse {
  cards: FastAPICard[];
  total_requested: number;
  total_found: number;
}

interface FastAPIAnalysisResponse {
  cards: FastAPICard[];
  formatted_prompt: string;
  ai_analysis: string;
  total_requested: number;
  total_found: number;
}

interface FastAPICard {
  multiverseId: number;
  name: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power?: string;
  toughness?: string;
  set_code: string;
  set_name: string;
  rarity: string;
  scryfall_id: string;
  scryfall_uri: string;
  image_uris: Record<string, string>;
  legalities: Record<string, string>;
  released_at: string;
  collector_number: string;
  artist: string;
  prices: Record<string, string>;
  error?: string;
}

class MainService {
  private baseURL: string;

  constructor() {
    this.baseURL = SERVER_API_URL;
  }

  /**
   * Extract multiverse IDs from Scryfall cards
   */
  private extractMultiverseIdsFromScryfallCards(scryfallCards: Map<string, ScryfallCard>): number[] {
    const multiverseIds: number[] = [];
    
    console.log(`Extracting multiverse IDs from ${scryfallCards.size} Scryfall cards`);
    
    for (const [cardName, scryfallCard] of scryfallCards.entries()) {
      // Scryfall cards have multiverse_ids as an array
      if (scryfallCard.multiverse_ids && Array.isArray(scryfallCard.multiverse_ids) && scryfallCard.multiverse_ids.length > 0) {
        const multiverseId = scryfallCard.multiverse_ids[0]; // Use the first multiverse ID
        multiverseIds.push(multiverseId);
        console.log(`✅ Found multiverse ID ${multiverseId} for card: ${cardName}`);
      } else {
        console.warn(`❌ No multiverse ID found for card: ${cardName}`, scryfallCard);
      }
    }
    
    console.log(`Extracted ${multiverseIds.length} valid multiverse IDs:`, multiverseIds);
    return multiverseIds;
  }

  /**
   * Extract multiverse IDs from various card sources
   */
  private extractMultiverseIds(cards: (MTGJSONCard | ScryfallCard)[]): number[] {
    const multiverseIds: number[] = [];
    
    console.log(`Extracting multiverse IDs from ${cards.length} cards`);
    
    for (const card of cards) {
      let multiverseId: number | undefined;
      
      // Handle ScryfallCard (most common case)
      if ('multiverse_ids' in card && Array.isArray(card.multiverse_ids) && card.multiverse_ids.length > 0) {
        multiverseId = card.multiverse_ids[0];
        console.log(`✅ Found multiverse ID ${multiverseId} for Scryfall card: ${card.name}`);
      }
      // Handle MTGJSONCard
      else if ('multiverseId' in card && typeof card.multiverseId === 'number' && card.multiverseId > 0) {
        multiverseId = card.multiverseId;
        console.log(`✅ Found multiverse ID ${multiverseId} for MTGJSON card: ${card.name}`);
      }
      
      if (multiverseId && multiverseId > 0) {
        multiverseIds.push(multiverseId);
      } else {
        console.warn(`❌ No valid multiverse ID found for card: ${card.name}`);
      }
    }
    
    return multiverseIds;
  }

  /**
   * Analyze cards using AI through FastAPI server
   */
  async analyzeCards(multiverseIds: number[]): Promise<FastAPIAnalysisResponse> {
    if (multiverseIds.length === 0) {
      throw new Error('No multiverse IDs provided');
    }

    if (multiverseIds.length > 20) {
      throw new Error('Maximum 20 cards allowed for AI analysis');
    }

    const idsParam = multiverseIds.join(',');
    const url = `${this.baseURL}/analyzeCards?multiverse_ids=${idsParam}`;
    
    try {
      console.log(`Making AI analysis request to: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status}: ${errorData.detail || response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AI analysis timed out. Please try again with fewer cards or try again later.');
      }
      console.error('Failed to analyze cards with AI:', error);
      throw error;
    }
  }

  /**
   * Analyze cards from custom deck using Scryfall card data
   */
  async analyzeCustomDeckCards(scryfallCards: Map<string, ScryfallCard>): Promise<FastAPIAnalysisResponse> {
    console.log(`Starting AI analysis for ${scryfallCards.size} cards from custom deck`);
    
    const multiverseIds = this.extractMultiverseIdsFromScryfallCards(scryfallCards);
    
    if (multiverseIds.length === 0) {
      throw new Error('No valid multiverse IDs found in custom deck cards. This may happen if the cards are digital-only or token cards without multiverse IDs.');
    }

    // Limit to first 20 cards for AI analysis to stay within limits
    const limitedIds = multiverseIds.slice(0, 20);
    
    if (limitedIds.length < multiverseIds.length) {
      console.warn(`Custom deck has ${multiverseIds.length} cards, analyzing first ${limitedIds.length} for AI analysis`);
    }

    console.log(`Analyzing ${limitedIds.length} cards from custom deck`);
    return await this.analyzeCards(limitedIds);
  }

  /**
   * Analyze specific Scryfall cards
   */
  async analyzeScryfallCards(scryfallCards: ScryfallCard[]): Promise<FastAPIAnalysisResponse> {
    console.log(`Starting AI analysis for ${scryfallCards.length} Scryfall cards`);
    
    const multiverseIds = this.extractMultiverseIds(scryfallCards);
    
    if (multiverseIds.length === 0) {
      throw new Error('No valid multiverse IDs found in selected cards');
    }

    console.log(`Analyzing ${multiverseIds.length} Scryfall cards`);
    return await this.analyzeCards(multiverseIds);
  }

  /**
   * Check if FastAPI server is available
   */
  async checkServerHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/health`);
      return response.ok;
    } catch (error) {
      console.error('FastAPI server health check failed:', error);
      return false;
    }
  }

  /**
   * Get server status and information
   */
  async getServerInfo(): Promise<{ message: string; version: string }> {
    try {
      const response = await fetch(`${this.baseURL}/`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to get server info:', error);
      throw error;
    }
  }
}

export const mainService = new MainService();
export type { FastAPICardResponse, FastAPIAnalysisResponse, FastAPICard };

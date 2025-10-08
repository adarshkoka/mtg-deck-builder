import type { ScryfallCard, ScryfallCardSearch } from '../types/scryfall';

const SCRYFALL_API_BASE = 'https://api.scryfall.com';
const RATE_LIMIT_DELAY = 100; // 100ms between requests to respect rate limits

class ScryfallAPI {
  private lastRequestTime = 0;
  private cardCache = new Map<string, ScryfallCard>();

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      await new Promise(resolve => 
        setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  private async request<T>(endpoint: string): Promise<T> {
    await this.waitForRateLimit();
    
    try {
      const response = await fetch(`${SCRYFALL_API_BASE}${endpoint}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Scryfall API request failed:', error);
      throw error;
    }
  }

  // Search for preconstructed commander decks by name
  async searchPreconDecks(query: string): Promise<ScryfallCard[]> {
    // Search for commanders that might be from precon decks
    // This is a simplified approach - in reality, we'd need a more comprehensive database
    const searchQuery = encodeURIComponent(
      `${query} (is:commander OR type:legendary) (lang:en)`
    );
    
    const result = await this.request<ScryfallCardSearch>(
      `/cards/search?q=${searchQuery}&order=name`
    );
    
    return result.data;
  }

  // Get cards from a specific set (for precon decks)
  async getCardsFromSet(setCode: string): Promise<ScryfallCard[]> {
    const result = await this.request<ScryfallCardSearch>(
      `/cards/search?q=set:${setCode}&order=name`
    );
    
    return result.data;
  }

  // Search for cards with specific keywords
  async searchCardsByKeywords(keywords: string[], colors: string[]): Promise<ScryfallCard[]> {
    const keywordQuery = keywords.map(k => `oracle:"${k}"`).join(' OR ');
    const colorQuery = colors.length > 0 ? ` (${colors.map(c => `color:${c}`).join(' OR ')})` : '';
    
    const searchQuery = encodeURIComponent(
      `(${keywordQuery})${colorQuery} format:commander`
    );
    
    const result = await this.request<ScryfallCardSearch>(
      `/cards/search?q=${searchQuery}&order=name`
    );
    
    return result.data;
  }

  private transformScryfallCard(card: any): ScryfallCard {
    // Parse type_line into separate arrays
    const typeLine = card.type_line || '';
    
    // Split on '—' to separate main types from subtypes
    const [mainTypePart = '', subtypePart = ''] = typeLine.split('—').map((s: string) => s.trim());
    
    // Split main type part on spaces to get supertypes and types
    const mainTypeParts = mainTypePart.split(/\s+/).filter(Boolean);
    
    // Known supertypes
    const knownSupertypes = ['Legendary', 'Basic', 'Snow', 'World'];
    const supertypes = mainTypeParts.filter((part: string) => knownSupertypes.includes(part));
    const types = mainTypeParts.filter((part: string) => !knownSupertypes.includes(part));
    
    // Parse subtypes
    const subtypes = subtypePart ? subtypePart.split(/\s+/).filter(Boolean) : [];

    return {
      ...card,
      supertypes,
      types,
      subtypes
    };
  }
  async getCardByName(name: string): Promise<ScryfallCard> {
    // Check cache first
    if (this.cardCache.has(name)) {
      return this.cardCache.get(name)!;
    }

    const encodedName = encodeURIComponent(name);
    const rawCard = await this.request<any>(`/cards/named?exact=${encodedName}`);
    
    // Transform the card to include parsed types
    const card = this.transformScryfallCard(rawCard);
    
    // Cache the result
    this.cardCache.set(name, card);
    return card;
  }

  // Get card by multiverseId (preferred method for accurate images)
  async getCardByMultiverseId(multiverseId: number): Promise<ScryfallCard> {
    const cacheKey = `multiverse:${multiverseId}`;
    
    // Check cache first
    if (this.cardCache.has(cacheKey)) {
      return this.cardCache.get(cacheKey)!;
    }

    try {
      const rawCard = await this.request<any>(`/cards/multiverse/${multiverseId}`);
      const card = this.transformScryfallCard(rawCard);
      
      // Cache the result
      this.cardCache.set(cacheKey, card);
      return card;
    } catch (error) {
      console.warn(`Failed to fetch card by multiverseId ${multiverseId}:`, error);
      throw error;
    }
  }

  // Get card with intelligent fallback (multiverseId -> set+name -> exact name)
  async getCardWithFallback(cardData: {
    name: string;
    multiverseId?: number;
    setCode?: string;
  }): Promise<ScryfallCard> {
    const { name, multiverseId, setCode } = cardData;
    
    // Method 1: Try multiverseId first (most accurate for correct images)
    if (multiverseId) {
      try {
        const card = await this.getCardByMultiverseId(multiverseId);
        console.log(`✅ Found ${name} via multiverseId ${multiverseId}`);
        return card;
      } catch (error) {
        console.warn(`❌ MultiverseId ${multiverseId} failed for ${name}, trying fallback`);
      }
    }

    // Method 2: Try set-specific search (e.g., "Fallout Plains" for set PIP)
    if (setCode) {
      try {
        const encodedName = encodeURIComponent(name);
        const rawCard = await this.request<any>(`/cards/named?exact=${encodedName}&set=${setCode}`);
        const card = this.transformScryfallCard(rawCard);
        
        const cacheKey = `set:${setCode}:${name}`;
        this.cardCache.set(cacheKey, card);
        
        console.log(`✅ Found ${name} via set ${setCode}`);
        return card;
      } catch (error) {
        console.warn(`❌ Set-specific search failed for ${name} in ${setCode}, trying exact name`);
      }
    }

    // Method 3: Fallback to exact name search (may get wrong printing)
    try {
      const card = await this.getCardByName(name);
      console.log(`⚠️  Found ${name} via exact name (may be wrong printing)`);
      return card;
    } catch (error) {
      console.error(`❌ All methods failed for card ${name}`);
      throw error;
    }
  }

  // Get multiple cards by name with batching for rate limiting
  async getCardsByNames(names: string[]): Promise<Map<string, ScryfallCard>> {
    const results = new Map<string, ScryfallCard>();
    
    // Process in batches to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (name) => {
        try {
          const card = await this.getCardByName(name);
          if (card) {
            results.set(name, card);
          }
        } catch (error) {
          console.warn(`Failed to fetch card "${name}":`, error);
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches
      if (i + batchSize < names.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return results;
  }

  // Get multiple cards with intelligent fallback (preferred method)
  async getCardsWithFallback(cardDataList: Array<{
    name: string;
    multiverseId?: number;
    setCode?: string;
  }>): Promise<Map<string, ScryfallCard>> {
    const results = new Map<string, ScryfallCard>();
    
    // Process in batches to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < cardDataList.length; i += batchSize) {
      const batch = cardDataList.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (cardData) => {
        try {
          const card = await this.getCardWithFallback(cardData);
          if (card) {
            results.set(cardData.name, card);
          }
        } catch (error) {
          console.warn(`Failed to fetch card "${cardData.name}":`, error);
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches
      if (i + batchSize < cardDataList.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return results;
  }

  // Clear cache to free memory
  clearCache(): void {
    this.cardCache.clear();
  }

  // Get random cards (for testing)
  async getRandomCards(count: number = 1): Promise<ScryfallCard[]> {
    const promises = Array(count).fill(null).map(() => 
      this.request<ScryfallCard>('/cards/random?q=format:commander')
    );
    
    return await Promise.all(promises);
  }
}

export const scryfallAPI = new ScryfallAPI();
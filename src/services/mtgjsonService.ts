import axios from 'axios';
import type { MTGJSONSet, MTGJSONDeck, PreconDeckSearchResult, MTGJSONCard } from '../types/mtgjson';

class MTGJSONService {
  private readonly baseURL = 'https://mtgjson.com/api/v5';
  private deckCache = new Map<string, MTGJSONDeck>();
  private searchCache = new Map<string, PreconDeckSearchResult[]>();

  constructor() {
    // All data will be loaded from MTGJSON API dynamically
  }

  /**
   * Search for precon decks by name using MTGJSON API across all sets
   */
  async searchDecks(query: string): Promise<PreconDeckSearchResult[]> {
    if (!query.trim()) return [];
    
    // Check cache first
    const cacheKey = query.toLowerCase();
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey)!;
    }

    console.log(`Searching for decks with query: "${query}" across all MTGJSON sets`);
    const results: PreconDeckSearchResult[] = [];

    try {
      // Get all available sets
      const allSetsResponse = await axios.get(`${this.baseURL}/SetList.json`);
      const allSets: any[] = allSetsResponse.data.data;
      
      // Filter to sets that might contain Commander decks
      const commanderSets = allSets.filter(set => 
        set.type === 'commander' || 
        set.name.toLowerCase().includes('commander') ||
        set.name.toLowerCase().includes('universes beyond') ||
        set.name.toLowerCase().includes('duskmourn') ||
        // Include major recent sets that have commander products
        ['PIP', 'DSK', 'DSC', 'CMM', 'WHO', 'LTC', 'MOC', 'BRC', 'NCC'].includes(set.code)
      );

      console.log(`Searching ${commanderSets.length} potential Commander sets...`);

      // Search through commander sets in parallel for better performance
      const searchPromises = commanderSets.map(async (set) => {
        try {
          return await this.getDecksFromSet(set.code, query);
        } catch (error) {
          console.warn(`Failed to search decks in set ${set.code}:`, error);
          return [];
        }
      });

      const allResults = await Promise.all(searchPromises);
      
      // Flatten results
      for (const setResults of allResults) {
        results.push(...setResults);
      }

    } catch (error) {
      console.error('Failed to fetch set list:', error);
      // Fallback to searching known sets
      const fallbackSets = ['PIP', 'DSK', 'DSC', 'CMM', 'WHO', 'LTC', 'MOC', 'BRC', 'NCC'];
      for (const setCode of fallbackSets) {
        try {
          const setDecks = await this.getDecksFromSet(setCode, query);
          results.push(...setDecks);
        } catch (error) {
          console.warn(`Failed to search decks in fallback set ${setCode}:`, error);
        }
      }
    }

    // Cache the results
    this.searchCache.set(cacheKey, results);
    
    console.log(`Found ${results.length} decks for query "${query}":`, results.map(d => d.name));
    return results;
  }

  /**
   * Get all decks from a specific set that match the search query
   */
  private async getDecksFromSet(setCode: string, query?: string): Promise<PreconDeckSearchResult[]> {
    try {
      console.log(`Fetching set data for ${setCode}...`);
      const response = await axios.get(`${this.baseURL}/${setCode}.json`);
      const setData: MTGJSONSet = response.data.data;
      
      if (!setData.decks) {
        console.log(`No decks found in set ${setCode}`);
        return [];
      }

      let filteredDecks = setData.decks.filter(deck => 
        deck.type === 'Commander Deck' || 
        (deck.commander && deck.commander.length > 0)
      );

      // If query provided, filter by name
      if (query) {
        const queryLower = query.toLowerCase();
        filteredDecks = filteredDecks.filter(deck => 
          deck.name.toLowerCase().includes(queryLower)
        );
      }

      console.log(`Found ${filteredDecks.length} matching decks in ${setCode}:`, filteredDecks.map(d => d.name));

      return filteredDecks.map(deck => ({
        name: deck.name,
        code: deck.code,
        commanders: deck.commander?.map(c => c.name) || [],
        primaryCommander: deck.commander?.[0]?.name || '',
        theme: this.inferTheme(deck.name),
        releaseDate: deck.releaseDate || setData.releaseDate
      }));
    } catch (error) {
      console.warn(`Failed to fetch set ${setCode}:`, error);
      return [];
    }
  }

  /**
   * Get full deck data including all cards from MTGJSON API
   */
  async getDeck(deckName: string): Promise<MTGJSONDeck | null> {
    // Check cache first
    if (this.deckCache.has(deckName)) {
      console.log(`Returning cached deck data for ${deckName}`);
      return this.deckCache.get(deckName)!;
    }

    console.log(`Fetching full deck data for: ${deckName}`);

    try {
      // Get all available sets
      const allSetsResponse = await axios.get(`${this.baseURL}/SetList.json`);
      const allSets: any[] = allSetsResponse.data.data;
      
      // Filter to sets that might contain Commander decks
      const commanderSets = allSets.filter(set => 
        set.type === 'commander' || 
        set.name.toLowerCase().includes('commander') ||
        set.name.toLowerCase().includes('universes beyond') ||
        set.name.toLowerCase().includes('duskmourn') ||
        // Include major recent sets that have commander products
        ['PIP', 'DSK', 'DSC', 'CMM', 'WHO', 'LTC', 'MOC', 'BRC', 'NCC'].includes(set.code)
      );

      // Search through commander sets to find the deck
      for (const set of commanderSets) {
        try {
          const response = await axios.get(`${this.baseURL}/${set.code}.json`);
          const setData: MTGJSONSet = response.data.data;
          
          if (!setData.decks) continue;

          const foundDeck = setData.decks.find(deck => deck.name === deckName);
          if (foundDeck) {
            console.log(`Found deck ${deckName} in set ${set.code}`);
            const transformedDeck = this.transformDeck(foundDeck, setData);
            
            // Cache the result
            this.deckCache.set(deckName, transformedDeck);
            
            return transformedDeck;
          }
        } catch (error) {
          console.warn(`Failed to search for deck ${deckName} in set ${set.code}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to fetch set list:', error);
      // Fallback to searching known sets
      const fallbackSets = ['PIP', 'DSK', 'DSC', 'CMM', 'WHO', 'LTC', 'MOC', 'BRC', 'NCC'];
      for (const setCode of fallbackSets) {
        try {
          const response = await axios.get(`${this.baseURL}/${setCode}.json`);
          const setData: MTGJSONSet = response.data.data;
          
          if (!setData.decks) continue;

          const foundDeck = setData.decks.find(deck => deck.name === deckName);
          if (foundDeck) {
            console.log(`Found deck ${deckName} in set ${setCode}`);
            const transformedDeck = this.transformDeck(foundDeck, setData);
            
            // Cache the result
            this.deckCache.set(deckName, transformedDeck);
            
            return transformedDeck;
          }
        } catch (error) {
          console.warn(`Failed to search for deck ${deckName} in set ${setCode}:`, error);
        }
      }
    }

    console.warn(`Deck ${deckName} not found in any Commander sets`);
    return null;
  }

  /**
   * Transform MTGJSON deck data to our internal format
   */
  private transformDeck(deck: any, setData: any): MTGJSONDeck {
    console.log(`Transforming deck: ${deck.name}`);
    console.log(`Main board items: ${deck.mainBoard?.length || 0}`);
    console.log(`Official commander items: ${deck.commander?.length || 0}`);

    // Create a lookup map for cards by UUID
    const cardLookup = new Map<string, any>();
    if (setData.cards) {
      for (const card of setData.cards) {
        cardLookup.set(card.uuid, card);
      }
    }

    // Get official primary commanders first (these are the main ones like Dogmeat, Caesar)
    const primaryCommanders = (deck.commander || []).map((item: any) => {
      const card = cardLookup.get(item.uuid);
      if (!card) {
        console.warn(`Primary commander not found for UUID: ${item.uuid}`);
        return null;
      }
      return { ...card, count: item.count };
    }).filter(Boolean);

    console.log(`Found ${primaryCommanders.length} primary commanders:`, primaryCommanders.map((c: any) => c.name));

    // Transform deck list items (UUID + count) to full card objects
    const mainBoardCards = (deck.mainBoard || []).map((item: any) => {
      const card = cardLookup.get(item.uuid);
      if (!card) {
        console.warn(`Card not found for UUID: ${item.uuid}`);
        return null;
      }
      return { ...card, count: item.count };
    }).filter(Boolean);

    const sideBoardCards = (deck.sideBoard || []).map((item: any) => {
      const card = cardLookup.get(item.uuid);
      if (!card) return null;
      return { ...card, count: item.count };
    }).filter(Boolean);

    // Find additional legendary creatures from mainBoard (excluding primary commanders)
    const primaryCommanderUuids = new Set(primaryCommanders.map((c: any) => c.uuid));
    const additionalCommanders = mainBoardCards.filter((card: any) => 
      card.supertypes?.includes('Legendary') && 
      card.types?.includes('Creature') &&
      !primaryCommanderUuids.has(card.uuid)
    );

    // Combine primary commanders first, then additional commanders
    const allCommanders = [...primaryCommanders, ...additionalCommanders];

    console.log(`Found ${additionalCommanders.length} additional commanders:`, additionalCommanders.map((c: any) => c.name));
    console.log(`Total commanders: ${allCommanders.length}:`, allCommanders.map((c: any) => c.name));

    // Remove ALL commanders from main board to avoid duplication
    const allCommanderUuids = new Set(allCommanders.map((c: any) => c.uuid));
    const mainBoardWithoutCommanders = mainBoardCards.filter((card: any) => 
      !allCommanderUuids.has(card.uuid)
    );

    console.log(`Main board cards after removing commanders: ${mainBoardWithoutCommanders.length}`);

    return {
      name: deck.name,
      code: deck.code,
      type: deck.type || 'Commander Deck',
      releaseDate: deck.releaseDate,
      commander: allCommanders.map((card: any) => this.transformCard(card)),
      mainBoard: mainBoardWithoutCommanders.map((card: any) => this.transformCard(card)),
      sideBoard: sideBoardCards.map((card: any) => this.transformCard(card))
    };
  }

  /**
   * Transform MTGJSON card data to our internal format
   */
  private transformCard(card: any): MTGJSONCard {
    return {
      name: card.name,
      uuid: card.uuid,
      scryfallId: card.identifiers?.scryfallId,
      multiverseId: card.identifiers?.multiverseId,
      manaValue: card.manaValue || 0,
      manaCost: card.manaCost,
      type: card.type,
      text: card.text,
      colors: card.colors || [],
      colorIdentity: card.colorIdentity || [],
      keywords: card.keywords || [],
      supertypes: card.supertypes || [],
      types: card.types || [],
      subtypes: card.subtypes || [],
      legalities: card.legalities || { commander: 'legal' },
      count: card.count || 1
    };
  }

  /**
   * Infer theme from deck name
   */
  private inferTheme(deckName: string): string {
    const name = deckName.toLowerCase();
    if (name.includes('scrappy') || name.includes('survivor')) return 'Fallout Survivors';
    if (name.includes('caesar') || name.includes('legion')) return 'Fallout Legion';
    if (name.includes('artifact')) return 'Artifacts';
    if (name.includes('token')) return 'Tokens';
    if (name.includes('vampire')) return 'Vampires';
    if (name.includes('dragon')) return 'Dragons';
    if (name.includes('zombie')) return 'Zombies';
    if (name.includes('elf')) return 'Elves';
    return 'Commander';
  }

  /**
   * Legacy method - no longer used as we search dynamically
   */
  getPreconDecks(): PreconDeckSearchResult[] {
    console.warn('getPreconDecks() is deprecated - use searchDecks() instead');
    return [];
  }

  /**
   * Legacy method - no longer needed
   */
  async initialize(): Promise<void> {
    // No longer needed as we search dynamically
    console.log('MTGJSONService: Dynamic search enabled, no initialization required');
  }
}

export const mtgjsonService = new MTGJSONService();
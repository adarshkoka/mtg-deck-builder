// PHASE 2: Local storage service for persistent data
import type { CustomDeck } from '../types/customDeck';
import type { PreconDeckSearchResult } from '../types/mtgjson';

const STORAGE_KEYS = {
  CUSTOM_DECK: 'mtg_custom_deck',
  SEARCH_HISTORY: 'mtg_search_history'
} as const;

export class StorageService {
  // Custom Deck Storage
  saveCustomDeck(deck: CustomDeck): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_DECK, JSON.stringify(deck));
    } catch (error) {
      console.warn('Failed to save custom deck to localStorage:', error);
    }
  }

  loadCustomDeck(): CustomDeck | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_DECK);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load custom deck from localStorage:', error);
    }
    return null;
  }

  clearCustomDeck(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_DECK);
    } catch (error) {
      console.warn('Failed to clear custom deck from localStorage:', error);
    }
  }

  // Search History Storage (last 4 analyzed deck searches)
  saveSearchHistory(searchedDecks: PreconDeckSearchResult[]): void {
    try {
      // Keep only the last 4 searches
      const history = searchedDecks.slice(-4);
      localStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(history));
    } catch (error) {
      console.warn('Failed to save search history to localStorage:', error);
    }
  }

  loadSearchHistory(): PreconDeckSearchResult[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load search history from localStorage:', error);
    }
    return [];
  }

  addToSearchHistory(decks: PreconDeckSearchResult[]): void {
    try {
      const currentHistory = this.loadSearchHistory();
      
      // Add new decks to the front and keep only last 4
      const newHistory = [...decks, ...currentHistory]
        .filter((deck, index, array) => 
          // Remove duplicates based on deck name
          array.findIndex(d => d.name === deck.name) === index
        )
        .slice(0, 4); // Keep only 4 most recent
      
      this.saveSearchHistory(newHistory);
    } catch (error) {
      console.warn('Failed to add to search history:', error);
    }
  }

  clearSearchHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.SEARCH_HISTORY);
    } catch (error) {
      console.warn('Failed to clear search history from localStorage:', error);
    }
  }
}

export const storageService = new StorageService();
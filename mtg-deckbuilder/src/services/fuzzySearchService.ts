import Fuse from 'fuse.js';
import type { PreconDeckSearchResult } from '../types/mtgjson';

export class FuzzySearchService {
  private fuse: Fuse<PreconDeckSearchResult>;

  constructor(decks: PreconDeckSearchResult[]) {
    // Configure Fuse.js for searching deck names, commanders, and themes
    const options = {
      keys: [
        { name: 'name', weight: 0.4 },
        { name: 'commanders', weight: 0.3 },
        { name: 'primaryCommander', weight: 0.3 },
        { name: 'theme', weight: 0.2 }
      ],
      threshold: 0.4, // Lower = more strict matching
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    };

    this.fuse = new Fuse(decks, options);
  }

  search(query: string, limit: number = 10): PreconDeckSearchResult[] {
    if (!query.trim()) return [];
    
    const results = this.fuse.search(query, { limit });
    return results.map(result => result.item);
  }

  updateDecks(decks: PreconDeckSearchResult[]): void {
    this.fuse.setCollection(decks);
  }
}

// Keyword mapping for common search terms to deck names/themes
export const searchKeywords: Record<string, string[]> = {
  'caesar': ['Hail Caesar', 'Legion'],
  'hail': ['Hail Caesar'],
  'legion': ['Hail Caesar'],
  'scrappy': ['Scrappy Survivors'],
  'survivors': ['Scrappy Survivors'],
  'dogmeat': ['Scrappy Survivors'],
  'dog': ['Scrappy Survivors'],
  'meat': ['Scrappy Survivors'],
  'death': ['Death Toll'],
  'toll': ['Death Toll'],
  'strong': ['Death Toll'],
  'mutant': ['Death Toll'],
  'brutish': ['Death Toll'],
  'fallout': ['Hail Caesar', 'Scrappy Survivors', 'Death Toll'],
  'red': ['Hail Caesar', 'Death Toll'],
  'white': ['Hail Caesar'],
  'green': ['Scrappy Survivors'],
  'black': ['Death Toll'],
  'junk': ['Scrappy Survivors'],
  'experience': ['Hail Caesar'],
  'soldier': ['Hail Caesar'],
  'warrior': ['Death Toll']
};
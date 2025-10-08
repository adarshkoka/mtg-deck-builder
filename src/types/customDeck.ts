import type { ScryfallCard } from './scryfall';

export interface CustomDeckCard {
  card: ScryfallCard;
  quantity: number;
  isCommander?: boolean;
  sourceDeck?: string;
}

export interface CustomDeck {
  name: string;
  commander?: ScryfallCard;
  cards: CustomDeckCard[];
  colorIdentity: string[];
}

export interface ValidationError {
  type: 'color-identity' | 'singleton' | 'deck-size' | 'commander-legality' | 'duplicate-commander';
  message: string;
  cardName?: string;
  severity: 'error' | 'warning';
}

export interface DeckValidation {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  cardCount: number;
  colorIdentity: string[];
}
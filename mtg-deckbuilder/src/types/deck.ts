// Types for the deck builder: the card shape it uses and the working deck.

// A card, in the shape used by the deck builder (based on Scryfall's card object).
export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  multiverse_ids?: number[]; // Array of multiverse IDs
  legalities: {
    commander: string;
  };
  image_uris?: {
    small: string;
    normal: string;
    large: string;
  };
  prices: {
    usd?: string;
  };
}

// The deck being built in the browser.
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
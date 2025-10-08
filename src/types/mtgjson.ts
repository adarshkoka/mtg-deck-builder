// MTGJSON types for Commander precon decks
export interface MTGJSONCard {
  name: string;
  uuid: string;
  scryfallId?: string;
  multiverseId?: number;
  manaCost?: string;
  manaValue: number;
  type: string;
  text?: string;
  colors: string[];
  colorIdentity: string[];
  keywords: string[];
  supertypes: string[];
  types: string[];
  subtypes: string[];
  legalities: {
    commander: string;
  };
  count?: number;
}

export interface MTGJSONDeck {
  name: string;
  code: string;
  type: string;
  releaseDate: string;
  commander?: MTGJSONCard[];
  mainBoard: MTGJSONCard[];
  sideBoard?: MTGJSONCard[];
}

export interface MTGJSONSet {
  name: string;
  code: string;
  type: string;
  releaseDate: string;
  decks?: MTGJSONDeck[];
}

export interface PreconDeckSearchResult {
  name: string;
  code: string;
  commanders: string[];
  primaryCommander?: string;
  theme?: string;
  releaseDate: string;
}
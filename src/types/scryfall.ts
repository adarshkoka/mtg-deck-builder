// Scryfall API types
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

export interface ScryfallList<T> {
  object: string;
  data: T[];
  has_more: boolean;
  next_page?: string;
}

export interface PreconDeck {
  id: string;
  name: string;
  code: string;
  commander?: ScryfallCard;
  cards: ScryfallCard[];
}

export interface ScryfallCardSearch {
  object: string;
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}
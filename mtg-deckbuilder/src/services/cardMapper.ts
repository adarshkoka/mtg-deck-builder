// Converts the backend's OwnedCard into the ScryfallCard shape the deck builder uses,
// and turns lists of card names (an AI recommendation, a saved deck) into a working deck.

import { api } from './api';
import type { OwnedCard } from '../types/backend';
import type { CustomDeck, CustomDeckCard, ScryfallCard } from '../types/deck';

const SUPERTYPES = ['Legendary', 'Basic', 'Snow', 'World'];

// "Legendary Creature — Elf Druid" -> supertypes [Legendary], types [Creature], subtypes [Elf, Druid]
export function parseTypeLine(typeLine: string): Pick<ScryfallCard, 'supertypes' | 'types' | 'subtypes'> {
  const front = typeLine.split(' // ')[0]; // two-faced cards: use the front face
  const [main = '', sub = ''] = front.split('—').map((part) => part.trim());
  const words = main.split(/\s+/).filter(Boolean);
  return {
    supertypes: words.filter((w) => SUPERTYPES.includes(w)),
    types: words.filter((w) => !SUPERTYPES.includes(w)),
    subtypes: sub ? sub.split(/\s+/).filter(Boolean) : [],
  };
}

export function toScryfallCard(card: OwnedCard): ScryfallCard {
  return {
    id: card.scryfall_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    colors: card.colors,
    color_identity: card.color_identity,
    keywords: card.keywords,
    multiverse_ids: card.multiverse_ids,
    ...parseTypeLine(card.type_line),
    legalities: { commander: card.legal_in_commander ? 'legal' : 'not_legal' },
    image_uris: card.image_url
      ? { small: card.image_url_small ?? card.image_url, normal: card.image_url, large: card.image_url }
      : undefined,
    prices: { usd: card.price_usd ?? undefined },
  };
}

const BASIC_COLORS: Record<string, string[]> = {
  Plains: ['W'],
  Island: ['U'],
  Swamp: ['B'],
  Mountain: ['R'],
  Forest: ['G'],
  Wastes: [],
};

// Basic lands aren't in the collection (they're unlimited), so build them by hand.
export function basicLandCard(name: string): ScryfallCard {
  const image = `https://api.scryfall.com/cards/named?format=image&version=normal&exact=${encodeURIComponent(name)}`;
  return {
    id: `basic-${name}`,
    name,
    cmc: 0,
    type_line: `Basic Land — ${name}`,
    oracle_text: '',
    colors: [],
    color_identity: BASIC_COLORS[name] ?? [],
    keywords: [],
    supertypes: ['Basic'],
    types: ['Land'],
    subtypes: [name],
    legalities: { commander: 'legal' },
    image_uris: { small: image, normal: image, large: image },
    prices: {},
  };
}

// Card names -> a working deck for the deck builder, with full card data from the collection.
export async function buildWorkingDeck(
  collectionId: number,
  name: string,
  commander: OwnedCard,
  cardNames: string[],
  basicLands: Record<string, number>,
): Promise<CustomDeck> {
  const owned = cardNames.length ? await api.lookupCards(collectionId, cardNames) : [];
  const commanderCard = toScryfallCard(commander);
  const cards: CustomDeckCard[] = [
    { card: commanderCard, quantity: 1, isCommander: true },
    ...owned.map((card) => ({ card: toScryfallCard(card), quantity: 1 })),
    ...Object.entries(basicLands)
      .filter(([, count]) => count > 0)
      .map(([land, count]) => ({ card: basicLandCard(land), quantity: count })),
  ];
  return { name, commander: commanderCard, cards, colorIdentity: commander.color_identity };
}

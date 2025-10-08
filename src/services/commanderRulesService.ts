import type { CustomDeck, ValidationError, DeckValidation } from '../types/customDeck';
import type { ScryfallCard } from '../types/scryfall';

export class CommanderRulesService {
  // Validate a complete custom deck
  validateDeck(deck: CustomDeck): DeckValidation {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Calculate total card count (excluding commander)
    const cardCount = deck.cards.reduce((total, deckCard) => {
      return deckCard.isCommander ? total : total + deckCard.quantity;
    }, 0);

    // Rule 1: Deck size must be exactly 100 cards (excluding commander)
    if (cardCount !== 100) {
      if (cardCount < 100) {
        errors.push({
          type: 'deck-size',
          message: `Deck must have exactly 100 cards. Currently has ${cardCount} cards (${100 - cardCount} short).`,
          severity: 'error'
        });
      } else {
        errors.push({
          type: 'deck-size',
          message: `Deck must have exactly 100 cards. Currently has ${cardCount} cards (${cardCount - 100} over).`,
          severity: 'error'
        });
      }
    }

    // Rule 2: Must have exactly one commander
    const commanders = deck.cards.filter(deckCard => deckCard.isCommander);
    if (commanders.length === 0) {
      errors.push({
        type: 'commander-legality',
        message: 'Deck must have a commander.',
        severity: 'error'
      });
    } else if (commanders.length > 1) {
      errors.push({
        type: 'duplicate-commander',
        message: 'Deck can only have one commander.',
        severity: 'error'
      });
    }

    // Rule 3: Singleton rule (except basic lands)
    const cardCounts = new Map<string, number>();
    deck.cards.forEach(deckCard => {
      if (!deckCard.isCommander) {
        const currentCount = cardCounts.get(deckCard.card.name) || 0;
        cardCounts.set(deckCard.card.name, currentCount + deckCard.quantity);
      }
    });

    cardCounts.forEach((quantity, cardName) => {
      const card = deck.cards.find(dc => dc.card.name === cardName)?.card;
      const isBasicLand = card?.supertypes?.includes('Basic') && card?.types?.includes('Land');
      
      if (quantity > 1 && !isBasicLand) {
        errors.push({
          type: 'singleton',
          message: `Only one copy of "${cardName}" allowed (found ${quantity}).`,
          cardName,
          severity: 'error'
        });
      }
    });

    // Rule 4: Color identity validation
    if (deck.commander) {
      const commanderColorIdentity = deck.commander.color_identity || [];
      
      deck.cards.forEach(deckCard => {
        if (!deckCard.isCommander) {
          const cardColorIdentity = deckCard.card.color_identity || [];
          const invalidColors = cardColorIdentity.filter(color => 
            !commanderColorIdentity.includes(color)
          );
          
          if (invalidColors.length > 0) {
            errors.push({
              type: 'color-identity',
              message: `"${deckCard.card.name}" contains colors (${invalidColors.join(', ')}) not in commander's color identity (${commanderColorIdentity.join(', ') || 'colorless'}).`,
              cardName: deckCard.card.name,
              severity: 'error'
            });
          }
        }
      });
    }

    // Rule 5: Commander type validation (basic checks only)
    if (deck.commander) {
      // Must be legendary creature (with some exceptions like planeswalkers)
      const isLegendary = deck.commander.supertypes?.includes('Legendary');
      const isCreature = deck.commander.types?.includes('Creature');
      const isPlaneswalker = deck.commander.types?.includes('Planeswalker');
      const hasPartner = deck.commander.oracle_text?.toLowerCase().includes('partner');

      if (!isLegendary || (!isCreature && !isPlaneswalker && !hasPartner)) {
        warnings.push({
          type: 'commander-legality',
          message: `"${deck.commander.name}" may not be a valid commander. Commanders must typically be legendary creatures or planeswalkers.`,
          cardName: deck.commander.name,
          severity: 'warning'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      cardCount,
      colorIdentity: deck.commander?.color_identity || []
    };
  }

  // Validate a single card addition to the deck
  validateCardAddition(card: ScryfallCard, deck: CustomDeck, asCommander: boolean = false): ValidationError[] {
    const errors: ValidationError[] = [];

    if (asCommander) {
      // Check if already has commander
      if (deck.commander) {
        errors.push({
          type: 'duplicate-commander',
          message: 'Deck already has a commander. Remove current commander first.',
          severity: 'error'
        });
      }
    } else {
      // Regular card validation
      
      // Color identity check
      if (deck.commander) {
        const commanderColorIdentity = deck.commander.color_identity || [];
        const cardColorIdentity = card.color_identity || [];
        const invalidColors = cardColorIdentity.filter(color => 
          !commanderColorIdentity.includes(color)
        );
        
        if (invalidColors.length > 0) {
          errors.push({
            type: 'color-identity',
            message: `"${card.name}" contains colors (${invalidColors.join(', ')}) not in commander's color identity.`,
            cardName: card.name,
            severity: 'error'
          });
        }
      }

      // Singleton check
      const existingCard = deck.cards.find(dc => dc.card.name === card.name && !dc.isCommander);
      const isBasicLand = card.supertypes?.includes('Basic') && card.types?.includes('Land');
      
      if (existingCard && !isBasicLand) {
        errors.push({
          type: 'singleton',
          message: `"${card.name}" is already in the deck. Only one copy allowed.`,
          cardName: card.name,
          severity: 'error'
        });
      }

      // Deck size check
      const currentCount = deck.cards.reduce((total, deckCard) => {
        return deckCard.isCommander ? total : total + deckCard.quantity;
      }, 0);

      if (currentCount >= 100) {
        errors.push({
          type: 'deck-size',
          message: 'Deck already has 100 cards. Remove a card first.',
          severity: 'error'
        });
      }
    }

    return errors;
  }

  // Get color identity from multiple cards
  getCombinedColorIdentity(cards: ScryfallCard[]): string[] {
    const allColors = new Set<string>();
    cards.forEach(card => {
      (card.color_identity || []).forEach(color => allColors.add(color));
    });
    return Array.from(allColors).sort();
  }

  // Check if a card fits in a specific color identity
  isCardValidForColorIdentity(card: ScryfallCard, allowedColors: string[]): boolean {
    const cardColors = card.color_identity || [];
    return cardColors.every(color => allowedColors.includes(color));
  }
}

export const commanderRulesService = new CommanderRulesService();
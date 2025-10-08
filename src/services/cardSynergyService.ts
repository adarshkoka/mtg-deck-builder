import type { ScryfallCard } from '../types/scryfall';
import type { MTGJSONDeck } from '../types/mtgjson';
import { extractKeywords, getCommanderRelevantKeywords } from '../data/magicKeywords';

export interface SynergyCard {
  card: ScryfallCard;
  sourceDeck: string;
  synergyReasons: string[];
  synergyScore: number;
}

export class CardSynergyService {
  // Find cards that synergize with a given commander
  findSynergisticCards(
    commander: ScryfallCard,
    availableDecks: MTGJSONDeck[],
    deckCards: Map<string, Map<string, ScryfallCard>>
  ): SynergyCard[] {
    const commanderKeywords = this.getCommanderKeywords(commander);
    const synergisticCards: SynergyCard[] = [];

    availableDecks.forEach(deck => {
      const deckCardMap = deckCards.get(deck.name);
      if (!deckCardMap) return;

      deck.mainBoard.forEach(mtgCard => {
        const scryfallCard = deckCardMap.get(mtgCard.name);
        if (!scryfallCard) return;

        // Skip if it's the same commander
        if (scryfallCard.name === commander.name) return;

        const synergy = this.calculateSynergy(commander, scryfallCard, commanderKeywords);
        
        if (synergy.score > 0) {
          synergisticCards.push({
            card: scryfallCard,
            sourceDeck: deck.name,
            synergyReasons: synergy.reasons,
            synergyScore: synergy.score
          });
        }
      });
    });

    // Sort by synergy score (highest first) and limit results
    return synergisticCards
      .sort((a, b) => b.synergyScore - a.synergyScore)
      .slice(0, 50); // Limit to top 50 synergistic cards
  }

  private getCommanderKeywords(commander: ScryfallCard): string[] {
    const keywords = extractKeywords(commander.oracle_text || '');
    return getCommanderRelevantKeywords(keywords);
  }

  private calculateSynergy(
    commander: ScryfallCard,
    card: ScryfallCard,
    commanderKeywords: string[]
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    const cardText = (card.oracle_text || '').toLowerCase();
    const commanderText = (commander.oracle_text || '').toLowerCase();
    const cardKeywords = extractKeywords(card.oracle_text || '');

    // 1. Direct keyword synergy
    commanderKeywords.forEach(keyword => {
      if (cardText.includes(keyword.toLowerCase())) {
        score += 3;
        reasons.push(`Shares "${keyword}" synergy`);
      }
    });

    // 2. Color identity compatibility
    const commanderColors = commander.color_identity || [];
    const cardColors = card.color_identity || [];
    const sharedColors = cardColors.filter(color => commanderColors.includes(color));
    
    if (sharedColors.length > 0) {
      score += 1;
      reasons.push(`Compatible colors (${sharedColors.join(', ')})`);
    }

    // 3. Specific synergy patterns
    
    // Experience counter synergy
    if (commanderText.includes('experience counter')) {
      if (cardText.includes('experience counter')) {
        score += 5;
        reasons.push('Experience counter synergy');
      }
    }

    // Token synergy
    if (commanderText.includes('token') || commanderText.includes('create')) {
      if (cardText.includes('token') || cardText.includes('create')) {
        score += 2;
        reasons.push('Token synergy');
      }
    }

    // Artifact synergy
    if (commanderText.includes('artifact') || commanderColors.length === 0) {
      if (cardText.includes('artifact') || card.types?.includes('Artifact')) {
        score += 2;
        reasons.push('Artifact synergy');
      }
    }

    // Graveyard synergy
    if (commanderText.includes('graveyard') || commanderText.includes('exile')) {
      if (cardText.includes('graveyard') || cardText.includes('exile')) {
        score += 2;
        reasons.push('Graveyard synergy');
      }
    }

    // Creature synergy
    if (commander.types?.includes('Creature')) {
      if (card.types?.includes('Creature')) {
        score += 1;
        reasons.push('Creature tribal');
      }
    }

    // Combat synergy
    if (commanderText.includes('attack') || commanderText.includes('combat')) {
      if (cardText.includes('attack') || cardText.includes('combat') || 
          cardKeywords.some(k => ['Haste', 'Trample', 'Flying', 'Menace'].includes(k))) {
        score += 2;
        reasons.push('Combat synergy');
      }
    }

    // Sacrifice synergy
    if (commanderText.includes('sacrifice')) {
      if (cardText.includes('sacrifice') || cardText.includes('when') && cardText.includes('dies')) {
        score += 3;
        reasons.push('Sacrifice synergy');
      }
    }

    // Mana/ramp synergy
    if (cardText.includes('add') && (cardText.includes('mana') || /\{[WUBRG]\}/.test(cardText))) {
      score += 1;
      reasons.push('Mana acceleration');
    }

    // Card draw synergy
    if (cardText.includes('draw') && cardText.includes('card')) {
      score += 1;
      reasons.push('Card advantage');
    }

    // 4. Type line synergy
    if (commander.type_line && card.type_line) {
      const commanderSubtypes = commander.type_line.split('—')[1]?.trim().split(' ') || [];
      const cardSubtypes = card.type_line.split('—')[1]?.trim().split(' ') || [];
      
      const sharedSubtypes = commanderSubtypes.filter(subtype => 
        cardSubtypes.includes(subtype) && subtype !== 'Creature'
      );
      
      if (sharedSubtypes.length > 0) {
        score += 2;
        reasons.push(`Tribal synergy (${sharedSubtypes.join(', ')})`);
      }
    }

    // 5. Utility and staples bonus
    const utilityKeywords = ['flying', 'deathtouch', 'removal', 'counterspell', 'protection'];
    if (utilityKeywords.some(keyword => cardText.includes(keyword))) {
      score += 1;
      reasons.push('Utility/Protection');
    }

    return { score, reasons: reasons.slice(0, 3) }; // Limit to top 3 reasons
  }

  // Get synergy explanation for UI
  getSynergyExplanation(commander: ScryfallCard, card: ScryfallCard): string[] {
    const commanderKeywords = this.getCommanderKeywords(commander);
    const synergy = this.calculateSynergy(commander, card, commanderKeywords);
    return synergy.reasons;
  }
}

export const cardSynergyService = new CardSynergyService();
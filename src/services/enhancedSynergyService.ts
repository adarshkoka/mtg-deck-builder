/**
 * Enhanced Synergy Rules Engine
 * 
 * This engine processes the comprehensive MTG mechanics database to identify
 * meaningful synergies between cards, focusing on actual game mechanics
 * rather than superficial pattern matching.
 */

import { COMPREHENSIVE_MTG_DATA } from '../data/comprehensiveMtgMechanics';
import type { ScryfallCard } from '../types/scryfall';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface SynergyScore {
  mechanicSynergy: number;    // Cross-mechanic interactions
  strategicSynergy: number;   // Fits deck archetype
  functionalSynergy: number;  // Generally good cards
  totalScore: number;
  explanation: string[];
}

export interface CardFeatures {
  keywordAbilities: string[];
  keywordActions: string[];
  abilityWords: string[];
  tokenTypes: string[];
  counterTypes: string[];
  tribes: string[];
  cardTypes: string[];
  colors: string[];
  manaCost: number;
  strategies: string[];
}

// ============================================================================
// ENHANCED FEATURE EXTRACTION
// ============================================================================

export class EnhancedFeatureExtractor {
  
  static extractFeatures(card: ScryfallCard): CardFeatures {
    const text = (card.oracle_text || '').toLowerCase();
    const typeLine = (card.type_line || '').toLowerCase();
    
    return {
      keywordAbilities: this.extractKeywordAbilities(text),
      keywordActions: this.extractKeywordActions(text),
      abilityWords: this.extractAbilityWords(text),
      tokenTypes: this.extractTokenTypes(text),
      counterTypes: this.extractCounterTypes(text),
      tribes: this.extractTribes(typeLine),
      cardTypes: this.extractCardTypes(typeLine),
      colors: card.color_identity || [],
      manaCost: card.mana_cost ? this.parseManaValue(card.mana_cost) : 0,
      strategies: this.identifyStrategies(card, text, typeLine)
    };
  }

  private static extractKeywordAbilities(text: string): string[] {
    const abilities: string[] = [];
    
    // Check each keyword ability from our comprehensive database
    Object.keys(COMPREHENSIVE_MTG_DATA.keywordAbilities).forEach(ability => {
      const abilityLower = ability.toLowerCase();
      // Escape special regex characters and check for ability word boundaries
      const escapedAbility = abilityLower.replace(/[+\-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const pattern = new RegExp(`\\b${escapedAbility}\\b`, 'i');
      if (pattern.test(text)) {
        abilities.push(ability);
      }
    });
    
    return abilities;
  }

  private static extractKeywordActions(text: string): string[] {
    const actions: string[] = [];
    
    COMPREHENSIVE_MTG_DATA.keywordActions.forEach(action => {
      const actionLower = action.toLowerCase();
      // Escape special regex characters and match keyword actions as verbs in context
      const escapedAction = actionLower.replace(/[+\-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const pattern = new RegExp(`\\b${escapedAction}\\b`, 'i');
      if (pattern.test(text)) {
        actions.push(action);
      }
    });
    
    return actions;
  }

  private static extractAbilityWords(text: string): string[] {
    const words: string[] = [];
    
    COMPREHENSIVE_MTG_DATA.abilityWords.forEach(word => {
      const wordLower = word.toLowerCase();
      // Ability words are italicized, but we'll check for the word itself
      if (text.includes(wordLower)) {
        words.push(word);
      }
    });
    
    return words;
  }

  private static extractTokenTypes(text: string): string[] {
    const tokens: string[] = [];
    
    Object.keys(COMPREHENSIVE_MTG_DATA.tokens).forEach(tokenName => {
      const tokenLower = tokenName.toLowerCase();
      // Escape special regex characters to be safe
      const escapedToken = tokenLower.replace(/[+\-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      
      // Look for "create/make X token" patterns
      const createPattern = new RegExp(`create.*${escapedToken}.*token`, 'i');
      const tokenPattern = new RegExp(`\\b${escapedToken} token`, 'i');
      
      if (createPattern.test(text) || tokenPattern.test(text)) {
        tokens.push(tokenName);
      }
    });
    
    return tokens;
  }

  private static extractCounterTypes(text: string): string[] {
    const counters: string[] = [];
    
    Object.keys(COMPREHENSIVE_MTG_DATA.counterTypes).forEach(counterType => {
      const counterLower = counterType.toLowerCase();
      // Escape special regex characters like +, /, etc.
      const escapedCounter = counterLower.replace(/[+\-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const pattern = new RegExp(`${escapedCounter} counter`, 'i');
      
      if (pattern.test(text)) {
        counters.push(counterType);
      }
    });
    
    return counters;
  }

  private static extractTribes(typeLine: string): string[] {
    // Common creature types that form tribes
    const commonTribes = [
      'human', 'elf', 'goblin', 'zombie', 'vampire', 'dragon', 'angel', 'demon',
      'spirit', 'elemental', 'beast', 'soldier', 'wizard', 'warrior', 'knight',
      'merfolk', 'artifact', 'sliver', 'cat', 'dog', 'rat', 'bird', 'snake'
    ];
    
    return commonTribes.filter(tribe => typeLine.includes(tribe));
  }

  private static extractCardTypes(typeLine: string): string[] {
    const types = [];
    
    if (typeLine.includes('creature')) types.push('creature');
    if (typeLine.includes('instant')) types.push('instant');
    if (typeLine.includes('sorcery')) types.push('sorcery');
    if (typeLine.includes('artifact')) types.push('artifact');
    if (typeLine.includes('enchantment')) types.push('enchantment');
    if (typeLine.includes('planeswalker')) types.push('planeswalker');
    if (typeLine.includes('land')) types.push('land');
    if (typeLine.includes('equipment')) types.push('equipment');
    if (typeLine.includes('aura')) types.push('aura');
    
    return types;
  }

  private static parseManaValue(manaCost: string): number {
    // Simple mana value calculation
    const numbers = manaCost.match(/\{(\d+)\}/g);
    const symbols = manaCost.match(/\{[WUBRG]\}/g);
    
    let total = 0;
    if (numbers) {
      numbers.forEach(num => {
        total += parseInt(num.replace(/[{}]/g, ''));
      });
    }
    if (symbols) {
      total += symbols.length;
    }
    
    return total;
  }

  private static identifyStrategies(card: ScryfallCard, text: string, typeLine: string): string[] {
    const strategies: string[] = [];
    
    // Identify strategies based on card characteristics
    Object.entries(COMPREHENSIVE_MTG_DATA.strategyArchetypes).forEach(([, archetype]) => {
      let matches = 0;
      
      // Check if card mechanics align with strategy
      archetype.keyMechanics.forEach(mechanic => {
        if (text.includes(mechanic.toLowerCase()) || 
            typeLine.includes(mechanic.toLowerCase())) {
          matches++;
        }
      });
      
      // Check if card types align
      archetype.cardTypes.forEach(cardType => {
        if (typeLine.includes(cardType)) {
          matches++;
        }
      });
      
      // Check color identity alignment
      if (card.color_identity && archetype.colors.includes('All')) {
        matches++;
      } else if (card.color_identity) {
        const colorMatches = card.color_identity.some(color => 
          archetype.colors.includes(this.mapColorSymbolToName(color))
        );
        if (colorMatches) matches++;
      }
      
      // If enough matches, consider it part of this strategy
      if (matches >= 2) {
        strategies.push(archetype.name);
      }
    });
    
    return strategies;
  }

  private static mapColorSymbolToName(symbol: string): string {
    const mapping: Record<string, string> = {
      'W': 'White',
      'U': 'Blue', 
      'B': 'Black',
      'R': 'Red',
      'G': 'Green'
    };
    return mapping[symbol] || symbol;
  }
}

// ============================================================================
// ENHANCED SYNERGY ANALYSIS ENGINE
// ============================================================================

export class EnhancedSynergyAnalyzer {
  
  static calculateSynergy(card1: ScryfallCard, card2: ScryfallCard): SynergyScore {
    const features1 = EnhancedFeatureExtractor.extractFeatures(card1);
    const features2 = EnhancedFeatureExtractor.extractFeatures(card2);
    
    const mechanicSynergy = this.calculateMechanicSynergy(features1, features2);
    const strategicSynergy = this.calculateStrategicSynergy(features1, features2);
    const functionalSynergy = this.calculateFunctionalSynergy(card1, card2, features1, features2);
    
    const totalScore = (mechanicSynergy * 0.5) + (strategicSynergy * 0.3) + (functionalSynergy * 0.2);
    
    const explanation = this.generateExplanation(card1, card2, features1, features2, {
      mechanicSynergy,
      strategicSynergy, 
      functionalSynergy,
      totalScore,
      explanation: []
    });
    
    return {
      mechanicSynergy,
      strategicSynergy,
      functionalSynergy,
      totalScore,
      explanation
    };
  }

  private static calculateMechanicSynergy(features1: CardFeatures, features2: CardFeatures): number {
    let score = 0;
    const explanations: string[] = [];
    
    // Check cross-mechanic synergies from our database
    COMPREHENSIVE_MTG_DATA.crossMechanicSynergies.forEach(synergy => {
      const card1Mechanics = [
        ...features1.keywordAbilities,
        ...features1.keywordActions,
        ...features1.tokenTypes,
        ...features1.counterTypes
      ];
      const card2Mechanics = [
        ...features2.keywordAbilities,
        ...features2.keywordActions,
        ...features2.tokenTypes,
        ...features2.counterTypes
      ];
      
      const card1HasMechanic = synergy.mechanics.some(mechanic => 
        card1Mechanics.some(cm => cm.toLowerCase().includes(mechanic.toLowerCase()))
      );
      const card2HasMechanic = synergy.mechanics.some(mechanic => 
        card2Mechanics.some(cm => cm.toLowerCase().includes(mechanic.toLowerCase()))
      );
      
      if (card1HasMechanic && card2HasMechanic) {
        score += synergy.synergyStrength;
        explanations.push(synergy.description);
      }
    });
    
    // Check keyword ability synergies
    features1.keywordAbilities.forEach(ability1 => {
      const abilityData = COMPREHENSIVE_MTG_DATA.keywordAbilities[ability1];
      if (abilityData) {
        features2.keywordAbilities.forEach(ability2 => {
          if (abilityData.synergiesWith.some(synergy => 
            synergy.toLowerCase().includes(ability2.toLowerCase()) ||
            ability2.toLowerCase().includes(synergy.toLowerCase())
          )) {
            score += 3;
          }
        });
      }
    });
    
    // Counter type synergies with proliferate
    if (features1.keywordActions.includes('Proliferate') || 
        features2.keywordActions.includes('Proliferate')) {
      [...features1.counterTypes, ...features2.counterTypes].forEach(counterType => {
        const counterData = COMPREHENSIVE_MTG_DATA.counterTypes[counterType];
        if (counterData && counterData.proliferateValue === 'high') {
          score += 4;
        }
      });
    }
    
    return Math.min(score, 10); // Cap at 10
  }

  private static calculateStrategicSynergy(features1: CardFeatures, features2: CardFeatures): number {
    let score = 0;
    
    // Cards that fit the same strategy archetype have synergy
    const commonStrategies = features1.strategies.filter(strategy => 
      features2.strategies.includes(strategy)
    );
    
    commonStrategies.forEach(strategy => {
      const archetype = Object.values(COMPREHENSIVE_MTG_DATA.strategyArchetypes)
        .find(arch => arch.name === strategy);
      
      if (archetype) {
        // Higher synergy for more popular/established archetypes
        score += Math.min(5, archetype.popularityRank / 5);
      }
    });
    
    // Tribal synergy
    const commonTribes = features1.tribes.filter(tribe => 
      features2.tribes.includes(tribe)
    );
    
    score += commonTribes.length * 2;
    
    return Math.min(score, 10);
  }

  private static calculateFunctionalSynergy(
    card1: ScryfallCard, 
    card2: ScryfallCard, 
    features1: CardFeatures, 
    features2: CardFeatures
  ): number {
    let score = 0;
    
    // Mana curve considerations
    const manaDifference = Math.abs(features1.manaCost - features2.manaCost);
    if (manaDifference >= 2 && manaDifference <= 4) {
      score += 2; // Good curve diversity
    }
    
    // Color pie considerations
    const colorOverlap = features1.colors.filter(color => 
      features2.colors.includes(color)
    ).length;
    
    if (colorOverlap > 0) {
      score += 1; // Can be played in same deck
    }
    
    // Utility value - some cards are just generally good
    const utilityKeywords = ['card draw', 'removal', 'ramp', 'protection'];
    const card1Text = (card1.oracle_text || '').toLowerCase();
    const card2Text = (card2.oracle_text || '').toLowerCase();
    
    utilityKeywords.forEach(utility => {
      if (card1Text.includes(utility) || card2Text.includes(utility)) {
        score += 1;
      }
    });
    
    return Math.min(score, 10);
  }

  private static generateExplanation(
    card1: ScryfallCard,
    card2: ScryfallCard,
    features1: CardFeatures,
    features2: CardFeatures,
    scores: SynergyScore
  ): string[] {
    const explanations: string[] = [];
    
    // Explain mechanic synergies
    if (scores.mechanicSynergy > 3) {
      explanations.push(`Strong mechanical synergy between ${card1.name} and ${card2.name}`);
    }
    
    // Explain strategic fit
    const commonStrategies = features1.strategies.filter(strategy => 
      features2.strategies.includes(strategy)
    );
    
    if (commonStrategies.length > 0) {
      explanations.push(`Both cards fit ${commonStrategies.join(', ')} strategy`);
    }
    
    // Explain tribal synergies
    const commonTribes = features1.tribes.filter(tribe => 
      features2.tribes.includes(tribe)
    );
    
    if (commonTribes.length > 0) {
      explanations.push(`Tribal synergy: both are ${commonTribes.join(', ')}`);
    }
    
    // Explain functional synergies
    if (scores.functionalSynergy > 2) {
      explanations.push(`Good functional synergy and mana curve fit`);
    }
    
    return explanations;
  }
}

// ============================================================================
// DECK STRATEGY ANALYZER
// ============================================================================

export class DeckStrategyAnalyzer {
  
  static analyzeStrategy(cards: ScryfallCard[]): {
    primaryStrategy: string;
    secondaryStrategies: string[];
    confidence: number;
    recommendations: string[];
  } {
    const strategyScores: Record<string, number> = {};
    
    // Analyze each card's contribution to strategies
    cards.forEach(card => {
      const features = EnhancedFeatureExtractor.extractFeatures(card);
      features.strategies.forEach(strategy => {
        strategyScores[strategy] = (strategyScores[strategy] || 0) + 1;
      });
    });
    
    // Sort strategies by prevalence
    const sortedStrategies = Object.entries(strategyScores)
      .sort(([,a], [,b]) => b - a);
    
    const primaryStrategy = sortedStrategies[0]?.[0] || 'Unknown';
    const secondaryStrategies = sortedStrategies.slice(1, 4).map(([strategy]) => strategy);
    
    // Calculate confidence based on how focused the deck is
    const totalCards = cards.length;
    const primaryCount = strategyScores[primaryStrategy] || 0;
    const confidence = Math.min(primaryCount / totalCards, 1.0);
    
    // Generate recommendations
    const recommendations = this.generateStrategicRecommendations(
      primaryStrategy, 
      secondaryStrategies,
      confidence
    );
    
    return {
      primaryStrategy,
      secondaryStrategies,
      confidence,
      recommendations
    };
  }
  
  private static generateStrategicRecommendations(
    primaryStrategy: string,
    _secondaryStrategies: string[],
    confidence: number
  ): string[] {
    const recommendations: string[] = [];
    
    if (confidence < 0.3) {
      recommendations.push('Deck lacks clear strategic focus - consider concentrating on one archetype');
    }
    
    if (confidence > 0.7) {
      recommendations.push(`Strong ${primaryStrategy} focus - look for cards that enhance this strategy`);
    }
    
    // Strategy-specific recommendations
    const archetype = Object.values(COMPREHENSIVE_MTG_DATA.strategyArchetypes)
      .find(arch => arch.name === primaryStrategy);
    
    if (archetype) {
      switch (archetype.synergyPriority) {
        case 'speed':
          recommendations.push('Focus on low mana cost enablers and efficient threats');
          break;
        case 'value':
          recommendations.push('Prioritize card advantage and repeatable effects');
          break;
        case 'protection':
          recommendations.push('Include protection and redundancy for key pieces');
          break;
        case 'consistency':
          recommendations.push('Add tutors and card selection to find key pieces');
          break;
      }
    }
    
    return recommendations;
  }
}

export { COMPREHENSIVE_MTG_DATA };
import type { ScryfallCard } from '../types/scryfall';
import type { MTGJSONDeck } from '../types/mtgjson';
import type { CustomDeck } from '../types/customDeck';
import { keywordExtractionService, type CardFeatures } from './keywordExtractionService';
import { EnhancedSynergyAnalyzer, EnhancedFeatureExtractor, type CardFeatures as EnhancedCardFeatures } from './enhancedSynergyService';
import { commanderRulesService } from './commanderRulesService';

/**
 * Represents a node in the synergy graph
 */
export interface CardNode {
  card: ScryfallCard;
  features: CardFeatures;
  enhancedFeatures: EnhancedCardFeatures;
  originDeck: string;
}

/**
 * Represents an edge in the synergy graph
 */
export interface SynergyEdge {
  targetCard: string;
  weight: number;
  reasons: string[];
}

/**
 * Graph-based synergy recommendation result
 */
export interface GraphSynergyCard {
  card: ScryfallCard;
  sourceDeck: string;
  synergyReasons: string[];
  synergyScore: number;
  level: 1 | 2; // Level 1 = direct synergy, Level 2 = chained synergy
  chainedThrough?: string; // For Level 2, which Level 1 card it chains through
}

/**
 * Graph-based synergy service implementing the Phase 3 plan
 * Uses a graph data structure to model card relationships and find multi-level synergies
 */
export class GraphSynergyService {
  private nodes: Map<string, CardNode> = new Map();
  private adjacencyList: Map<string, SynergyEdge[]> = new Map();

  /**
   * Clear the graph and rebuild with new card data
   */
  buildGraph(decks: MTGJSONDeck[], deckCards: Map<string, Map<string, ScryfallCard>>): void {
    console.log('📊 GraphSynergyService.buildGraph called');
    console.log('Number of decks:', decks.length);
    console.log('Deck names:', decks.map(d => d.name));
    
    this.nodes.clear();
    this.adjacencyList.clear();

    // Phase 1: Add all cards as nodes
    decks.forEach(deck => {
      console.log(`Processing deck: ${deck.name}`);
      const cardMap = deckCards.get(deck.name);
      if (!cardMap) {
        console.log(`❌ No card map found for deck: ${deck.name}`);
        return;
      }

      console.log(`Found ${cardMap.size} cards in ${deck.name}`);
      
      // Add commanders to the graph
      if (deck.commander) {
        console.log(`Adding ${deck.commander.length} commanders from ${deck.name}`);
        deck.commander.forEach(commanderCard => {
          const scryfallCard = cardMap.get(commanderCard.name);
          if (scryfallCard) {
            const features = keywordExtractionService.extractFeatures(scryfallCard);
            const enhancedFeatures = EnhancedFeatureExtractor.extractFeatures(scryfallCard);
            const node: CardNode = {
              card: scryfallCard,
              features,
              enhancedFeatures,
              originDeck: deck.name
            };

            this.nodes.set(scryfallCard.name, node);
            this.adjacencyList.set(scryfallCard.name, []);
            console.log(`✅ Added commander to graph: ${scryfallCard.name}`);
          } else {
            console.log(`⚠️ Commander Scryfall card not found for: ${commanderCard.name}`);
          }
        });
      }
      
      // Add mainBoard cards to the graph
      deck.mainBoard.forEach(mtgCard => {
        const scryfallCard = cardMap.get(mtgCard.name);
        if (!scryfallCard) {
          console.log(`⚠️ Scryfall card not found for: ${mtgCard.name}`);
          return;
        }

        const features = keywordExtractionService.extractFeatures(scryfallCard);
        const enhancedFeatures = EnhancedFeatureExtractor.extractFeatures(scryfallCard);
        const node: CardNode = {
          card: scryfallCard,
          features,
          enhancedFeatures,
          originDeck: deck.name
        };

        this.nodes.set(scryfallCard.name, node);
        this.adjacencyList.set(scryfallCard.name, []);
      });
    });

    console.log(`✅ Added ${this.nodes.size} nodes to graph`);

    // Phase 2: Calculate synergies and create edges
    this.calculateAllSynergies();
  }

  /**
   * Calculate synergies between all card pairs and create weighted edges
   */
  private calculateAllSynergies(): void {
    console.log('🔗 Calculating synergies between all card pairs...');
    const nodeArray = Array.from(this.nodes.values());
    let edgeCount = 0;

    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const node1 = nodeArray[i];
        const node2 = nodeArray[j];

        const synergy = this.calculateSynergyScore(node1, node2);
        
        if (synergy.score >= 3) { // Threshold for meaningful synergy
          edgeCount++;
          // Add bidirectional edges
          this.adjacencyList.get(node1.card.name)?.push({
            targetCard: node2.card.name,
            weight: synergy.score,
            reasons: synergy.reasons
          });

          this.adjacencyList.get(node2.card.name)?.push({
            targetCard: node1.card.name,
            weight: synergy.score,
            reasons: synergy.reasons
          });
        }
      }
    }

    console.log(`✅ Created ${edgeCount} synergy edges from ${nodeArray.length} nodes`);
  }

  /**
   * Calculate synergy score between two cards using enhanced research-based analysis
   */
  private calculateSynergyScore(node1: CardNode, node2: CardNode): { score: number; reasons: string[] } {
    // Use the enhanced synergy analyzer instead of the basic pattern matching
    const synergyResult = EnhancedSynergyAnalyzer.calculateSynergy(node1.card, node2.card);
    
    // Add cross-deck bonus if cards are from different decks
    let finalScore = synergyResult.totalScore;
    const reasons = [...synergyResult.explanation];
    
    if (node1.originDeck !== node2.originDeck) {
      finalScore += 2;
      reasons.push(`Cross-deck synergy (${node1.originDeck} + ${node2.originDeck})`);
    }

    return { 
      score: finalScore, 
      reasons: reasons.slice(0, 3) // Limit to top 3 reasons for readability
    };
  }

  /**
   * Find Level 1 synergies (direct connections to commander)
   * 
   * CONFIGURATION:
   * - Excludes ALL lands from recommendations
   * - Returns top 15 highest scoring recommendations
   * - Sorted by synergy score (highest first)
   */
  findLevel1Synergies(
    commander: ScryfallCard,
    selectedDecks: string[],
    customDeck?: CustomDeck
  ): GraphSynergyCard[] {
    console.log('🎯 Finding Level 1 synergies for commander:', commander.name);
    console.log('Selected decks for synergy search:', selectedDecks);
    
    // Find the commander's deck in the graph nodes
    const commanderNode = this.nodes.get(commander.name);
    const commanderDeck = commanderNode?.originDeck;
    console.log('Commander origin deck in graph:', commanderDeck);
    
    if (!commanderNode) {
      console.log('❌ Commander node not found in graph');
      console.log('Available nodes:', Array.from(this.nodes.keys()).slice(0, 5));
      return [];
    }

    const commanderEdges = this.adjacencyList.get(commander.name) || [];
    console.log(`Found ${commanderEdges.length} direct edges from commander`);
    
    const commanderColorIdentity = commander.color_identity || [];
    const cardsInCustomDeck = this.getCardsInCustomDeck(customDeck);

    const level1Synergies: GraphSynergyCard[] = [];

    commanderEdges.forEach(edge => {
      const targetNode = this.nodes.get(edge.targetCard);
      if (!targetNode) return;

      // Filter by selected decks - show cards FROM the selected decks
      if (!selectedDecks.includes(targetNode.originDeck)) {
        return;
      }

      // Skip if it's the same card as the commander (shouldn't happen but safety check)
      if (targetNode.card.name === commander.name) {
        return;
      }

      // Color identity check
      const isValidColor = commanderRulesService.isCardValidForColorIdentity(targetNode.card, commanderColorIdentity);
      if (!isValidColor) {
        console.log(`❌ Card ${targetNode.card.name} filtered out - color identity mismatch. Card colors: [${targetNode.card.color_identity?.join(', ') || 'none'}], Commander allows: [${commanderColorIdentity.join(', ') || 'none'}]`);
        return;
      }

      // Exclude all lands from recommendations
      if (targetNode.card.types?.includes('Land')) {
        return;
      }

      // Singleton rule check
      if (cardsInCustomDeck.has(targetNode.card.name)) {
        return; // Skip cards already in deck (no longer need basic land exception)
      }

      console.log(`✅ Adding Level 1 synergy: ${targetNode.card.name} (score: ${edge.weight})`);
      level1Synergies.push({
        card: targetNode.card,
        sourceDeck: targetNode.originDeck,
        synergyReasons: edge.reasons,
        synergyScore: edge.weight,
        level: 1
      });
    });

    // Sort by synergy score and return top 15 results
    const result = level1Synergies
      .sort((a, b) => b.synergyScore - a.synergyScore)
      .slice(0, 15); // Top 15 Level 1 synergies
    
    console.log(`✅ Found ${result.length} Level 1 synergies`);
    return result;
  }

  /**
   * Find Level 2 synergies (chained through Level 1 cards)
   * 
   * CONFIGURATION:
   * - Excludes ALL lands from recommendations  
   * - Returns top 15 highest scoring recommendations
   * - Removes duplicates (keeps highest scoring instance)
   * - Sorted by synergy score (highest first)
   */
  findLevel2Synergies(
    commander: ScryfallCard,
    level1Cards: GraphSynergyCard[],
    selectedDecks: string[],
    customDeck?: CustomDeck
  ): GraphSynergyCard[] {
    const commanderColorIdentity = commander.color_identity || [];
    const cardsInCustomDeck = this.getCardsInCustomDeck(customDeck);
    const level1CardNames = new Set(level1Cards.map(card => card.card.name));
    const level2Synergies: GraphSynergyCard[] = [];

    level1Cards.forEach(level1Card => {
      const level1Edges = this.adjacencyList.get(level1Card.card.name) || [];

      level1Edges.forEach(edge => {
        const targetNode = this.nodes.get(edge.targetCard);
        if (!targetNode) return;

        // Skip if it's the commander or already in Level 1
        if (targetNode.card.name === commander.name || level1CardNames.has(targetNode.card.name)) {
          return;
        }

        // Filter by selected decks - show cards FROM the selected decks
        if (!selectedDecks.includes(targetNode.originDeck)) return;

        // Color identity check
        const isValidColor = commanderRulesService.isCardValidForColorIdentity(targetNode.card, commanderColorIdentity);
        if (!isValidColor) {
          console.log(`❌ Level 2 card ${targetNode.card.name} filtered out - color identity mismatch. Card colors: [${targetNode.card.color_identity?.join(', ') || 'none'}], Commander allows: [${commanderColorIdentity.join(', ') || 'none'}]`);
          return;
        }

        // Exclude all lands from recommendations
        if (targetNode.card.types?.includes('Land')) {
          return;
        }

        // Singleton rule check
        if (cardsInCustomDeck.has(targetNode.card.name)) {
          return; // Skip cards already in deck (no longer need basic land exception)
        }

        // Calculate combined score (weighted towards Level 1 connection)
        const combinedScore = Math.floor(0.7 * edge.weight + 0.3 * level1Card.synergyScore);

        level2Synergies.push({
          card: targetNode.card,
          sourceDeck: targetNode.originDeck,
          synergyReasons: edge.reasons,
          synergyScore: combinedScore,
          level: 2,
          chainedThrough: level1Card.card.name
        });
      });
    });

    // Remove duplicates and sort by score
    const uniqueLevel2 = new Map<string, GraphSynergyCard>();
    level2Synergies.forEach(synergy => {
      const existing = uniqueLevel2.get(synergy.card.name);
      if (!existing || synergy.synergyScore > existing.synergyScore) {
        uniqueLevel2.set(synergy.card.name, synergy);
      }
    });

    return Array.from(uniqueLevel2.values())
      .sort((a, b) => b.synergyScore - a.synergyScore)
      .slice(0, 15); // Top 15 Level 2 synergies
  }

  /**
   * Get comprehensive synergy recommendations (both Level 1 and Level 2)
   */
  getRecommendations(
    commander: ScryfallCard,
    selectedDecks: string[],
    customDeck?: CustomDeck
  ): { level1: GraphSynergyCard[]; level2: GraphSynergyCard[] } {
    const level1 = this.findLevel1Synergies(commander, selectedDecks, customDeck);
    const level2 = this.findLevel2Synergies(commander, level1, selectedDecks, customDeck);

    return { level1, level2 };
  }

  /**
   * Get detailed explanation for a specific synergy
   */
  getSynergyExplanation(card1: ScryfallCard, card2: ScryfallCard): string[] {
    const edge = this.adjacencyList.get(card1.name)?.find(e => e.targetCard === card2.name);
    return edge?.reasons || [];
  }

  /**
   * Helper to get cards already in custom deck
   */
  private getCardsInCustomDeck(customDeck?: CustomDeck): Set<string> {
    const cardsInDeck = new Set<string>();
    if (customDeck) {
      customDeck.cards.forEach(deckCard => {
        if (!deckCard.isCommander) {
          cardsInDeck.add(deckCard.card.name);
        }
      });
    }
    return cardsInDeck;
  }

  /**
   * Get graph statistics for debugging
   */
  getGraphStats(): { nodeCount: number; edgeCount: number; avgDegree: number } {
    const nodeCount = this.nodes.size;
    let totalEdges = 0;
    
    this.adjacencyList.forEach(edges => {
      totalEdges += edges.length;
    });

    const edgeCount = totalEdges / 2; // Since edges are bidirectional
    const avgDegree = nodeCount > 0 ? totalEdges / nodeCount : 0;

    return { nodeCount, edgeCount, avgDegree };
  }
}

export const graphSynergyService = new GraphSynergyService();
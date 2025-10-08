import React, { useState, useEffect } from 'react';
import { scryfallAPI } from '../services/scryfallAPI';
import { mtgjsonService } from '../services/mtgjsonService';
import { graphSynergyService, type GraphSynergyCard } from '../services/graphSynergyService';
import { commanderRulesService } from '../services/commanderRulesService';
import { extractKeywords, getCommanderRelevantKeywords } from '../data/magicKeywords';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { CustomDeckView } from './CustomDeckView';
import type { PreconDeckSearchResult } from '../types/mtgjson';
import type { ScryfallCard } from '../types/scryfall';
import type { MTGJSONDeck, MTGJSONCard } from '../types/mtgjson';

interface DeckDisplayProps {
  selectedDecks: PreconDeckSearchResult[];
  onClose: () => void;
}

interface DeckData {
  deck: MTGJSONDeck;
  commanderCards: Map<string, ScryfallCard>;
  mainBoardCards: Map<string, ScryfallCard>;
}

interface SynergyState {
  isActive: boolean;
  selectedCommander?: ScryfallCard;
  commanderDeck?: string;
  selectedDecks: string[];
  suggestions: GraphSynergyCard[];
  loading: boolean;
}

export const DeckDisplay: React.FC<DeckDisplayProps> = ({ selectedDecks }) => {
  const [deckData, setDeckData] = useState<Map<string, DeckData>>(new Map());
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showCustomDeck, setShowCustomDeck] = useState(false);
  const [keywordFilter, setKeywordFilter] = useState<string | null>(null); // PHASE 2: Keyword filtering
  const [synergyState, setSynergyState] = useState<SynergyState>({
    isActive: false,
    selectedDecks: [],
    suggestions: [],
    loading: false
  });
  const [showFlareEffect, setShowFlareEffect] = useState<string | null>(null); // PHASE 2: Visual effects
  const [showFireworkEffect, setShowFireworkEffect] = useState<string | null>(null); // PHASE 2: Visual effects

  const { addCard, customDeck, getCardCount } = useCustomDeck();

  useEffect(() => {
    loadDecksData();
  }, [selectedDecks]);

  const loadDecksData = async () => {
    setLoading(true);
    setLoadingProgress(0);
    const newDeckData = new Map<string, DeckData>();

    for (let i = 0; i < selectedDecks.length; i++) {
      const deckInfo = selectedDecks[i];
      
      try {
        // Get deck data from MTGJSON
        const deck = await mtgjsonService.getDeck(deckInfo.name);
        if (!deck) continue;

        // Get commander cards from Scryfall using intelligent fallback
        const commanderCardData = deck.commander?.map(c => ({
          name: c.name,
          multiverseId: c.multiverseId,
          setCode: deck.code
        })) || [];
        const commanderCards = await scryfallAPI.getCardsWithFallback(commanderCardData);

        // For now, don't load all mainboard cards immediately to respect rate limits
        // They will be loaded on-demand when clicked
        const mainBoardCards = new Map<string, ScryfallCard>();

        newDeckData.set(deckInfo.name, {
          deck,
          commanderCards,
          mainBoardCards
        });

      } catch (error) {
        console.error(`Error loading deck ${deckInfo.name}:`, error);
      }

      setLoadingProgress(((i + 1) / selectedDecks.length) * 100);
    }

    setDeckData(newDeckData);
    setLoading(false);
  };

  const loadCardData = async (cardName: string, deckName: string) => {
    try {
      // Get the deck data to find multiverseId and setCode
      const deckInfo = deckData.get(deckName);
      if (!deckInfo) return;

      // Find the card in the deck data to get multiverseId
      const mtgjsonCard = deckInfo.deck.mainBoard.find(c => c.name === cardName);
      
      const card = await scryfallAPI.getCardWithFallback({
        name: cardName,
        multiverseId: mtgjsonCard?.multiverseId,
        setCode: deckInfo.deck.code
      });
      
      if (card) {
        setDeckData(prev => {
          const newData = new Map(prev);
          const deckInfo = newData.get(deckName);
          if (deckInfo) {
            deckInfo.mainBoardCards.set(cardName, card);
            newData.set(deckName, deckInfo);
          }
          return newData;
        });
        setSelectedCard(card);
      }
    } catch (error) {
      console.error(`Error loading card ${cardName}:`, error);
    }
  };

  const handleCardClick = async (card: MTGJSONCard, deckName: string) => {
    const deckInfo = deckData.get(deckName);
    if (!deckInfo) return;

    // Check if we already have the Scryfall data
    const scryfallCard = deckInfo.mainBoardCards.get(card.name) || 
                        deckInfo.commanderCards.get(card.name);

    if (scryfallCard) {
      setSelectedCard(scryfallCard);
    } else {
      // Load card data on demand
      await loadCardData(card.name, deckName);
    }
  };

  const handleCommanderClick = (commanderName: string, deckName: string) => {
    console.log('👑 handleCommanderClick called');
    console.log('Commander name:', commanderName);
    console.log('Deck name:', deckName);
    
    const deckInfo = deckData.get(deckName);
    console.log('Deck info found:', !!deckInfo);
    
    const commander = deckInfo?.commanderCards.get(commanderName);
    console.log('Commander card found:', !!commander);
    console.log('Commander details:', commander?.name, commander?.type_line);
    
    if (commander) {
      setSelectedCard(commander);
      console.log('✅ Selected card set to commander');
      
      // Reset synergy state when selecting a new commander
      setSynergyState({
        isActive: false,
        selectedCommander: commander,
        commanderDeck: deckName,
        selectedDecks: [],
        suggestions: [],
        loading: false
      });
      
      console.log('✅ Synergy state reset with new commander');
    } else {
      console.log('❌ Commander not found in deck data');
    }
  };

  const handleStartSynergy = () => {
    console.log('🚀 handleStartSynergy called');
    console.log('Selected card:', selectedCard?.name);
    console.log('Selected commander in synergy state:', synergyState.selectedCommander?.name);
    
    if (!selectedCard || !synergyState.selectedCommander) {
      console.log('❌ Early return: Missing selected card or commander');
      return;
    }
    
    console.log('✅ Starting synergy mode...');
    console.log('Available decks:', selectedDecks.map(d => d.name));
    
    setSynergyState(prev => ({
      ...prev,
      isActive: true,
      selectedDecks: selectedDecks.map(d => d.name) // Default to all decks
    }));
    
    console.log('Synergy state activated with decks:', selectedDecks.map(d => d.name));
  };

  const handleSynergyDeckToggle = (deckName: string) => {
    console.log('🔄 handleSynergyDeckToggle called for deck:', deckName);
    
    setSynergyState(prev => {
      const newSelectedDecks = prev.selectedDecks.includes(deckName)
        ? prev.selectedDecks.filter(d => d !== deckName)
        : [...prev.selectedDecks, deckName];
      
      console.log('Updated selected decks:', newSelectedDecks);
      
      return {
        ...prev,
        selectedDecks: newSelectedDecks
      };
    });
  };

  const handleFindSynergyCards = async () => {
    console.log('🔍 handleFindSynergyCards called');
    console.log('Selected commander:', synergyState.selectedCommander?.name);
    console.log('Selected decks:', synergyState.selectedDecks);
    
    if (!synergyState.selectedCommander || synergyState.selectedDecks.length === 0) {
      console.log('❌ Early return: Missing commander or no decks selected');
      return;
    }

    console.log('✅ Starting synergy analysis...');
    setSynergyState(prev => ({ ...prev, loading: true }));

    try {
      // Always include the commander's deck + selected decks for graph building
      const decksToInclude = new Set([
        ...(synergyState.commanderDeck ? [synergyState.commanderDeck] : []),
        ...synergyState.selectedDecks
      ]);
      
      const availableDecks = Array.from(deckData.values())
        .map(data => data.deck)
        .filter(deck => decksToInclude.has(deck.name));

      console.log('Available decks for analysis:', availableDecks.map(d => d.name));
      console.log('Commander deck:', synergyState.commanderDeck);
      console.log('Selected decks for synergy search:', synergyState.selectedDecks);

      const allDeckCards = new Map<string, Map<string, ScryfallCard>>();
      for (const deckName of Array.from(decksToInclude)) {
        console.log(`📥 Loading cards for deck: ${deckName}`);
        const deckInfo = deckData.get(deckName);
        if (deckInfo) {
          // Load all mainboard cards for synergy analysis
          const cardNames = deckInfo.deck.mainBoard.map(c => c.name);
          console.log(`Found ${cardNames.length} mainboard cards in ${deckName}`);
          
          const cardData = await scryfallAPI.getCardsByNames(cardNames);
          console.log(`Loaded ${cardData.size} Scryfall mainboard cards for ${deckName}`);
          
          // Also add commander cards that we already have loaded
          deckInfo.commanderCards.forEach((commanderCard, commanderName) => {
            cardData.set(commanderName, commanderCard);
            console.log(`✅ Added commander to card data: ${commanderName}`);
          });
          
          allDeckCards.set(deckName, cardData);
          console.log(`Total cards for ${deckName}: ${cardData.size}`);
        }
      }

      console.log('🏗️ Building synergy graph...');
      // Build the synergy graph with all available data
      graphSynergyService.buildGraph(availableDecks, allDeckCards);

      console.log('🔎 Getting recommendations...');
      // Get Level 1 and Level 2 recommendations
      const recommendations = graphSynergyService.getRecommendations(
        synergyState.selectedCommander,
        synergyState.selectedDecks,
        customDeck
      );

      console.log('Level 1 recommendations:', recommendations.level1.length);
      console.log('Level 2 recommendations:', recommendations.level2.length);

      // Combine Level 1 and Level 2 suggestions into a single array
      // Level 1 suggestions get priority (higher scores)
      const allSuggestions = [
        ...recommendations.level1,
        ...recommendations.level2
      ].sort((a, b) => b.synergyScore - a.synergyScore);

      console.log('🎯 Total combined suggestions:', allSuggestions.length);
      console.log('Top 5 suggestions:', allSuggestions.slice(0, 5).map(s => `${s.card.name} (${s.synergyScore})`));

      setSynergyState(prev => ({
        ...prev,
        suggestions: allSuggestions,
        loading: false
      }));
    } catch (error) {
      console.error('💥 Error finding synergy cards:', error);
      setSynergyState(prev => ({ 
        ...prev, 
        loading: false, 
        suggestions: []
      }));
    }
  };

  const handleAddToCustomDeck = async (card: ScryfallCard, asCommander: boolean = false) => {
    const errors = addCard(card, undefined, asCommander);
    if (errors.length > 0) {
      // Show error message to user
      alert(errors[0].message);
    } else {
      // PHASE 2: Trigger visual effects on successful add
      const effectId = `${card.id}-${Date.now()}`;
      if (asCommander) {
        setShowFireworkEffect(effectId);
        setTimeout(() => setShowFireworkEffect(null), 800); // Match animation duration
      } else {
        setShowFlareEffect(effectId);
        setTimeout(() => setShowFlareEffect(null), 600); // Match animation duration
      }
    }
  };

  const getCardKeywords = (card: ScryfallCard): string[] => {
    const keywords = extractKeywords(card.oracle_text || '');
    return getCommanderRelevantKeywords(keywords);
  };

  // PHASE 2: Handle keyword filtering
  const handleKeywordFilter = (keyword: string) => {
    setKeywordFilter(prevFilter => prevFilter === keyword ? null : keyword);
  };

  // PHASE 2: Filter cards by keyword while maintaining deck separation
  const getFilteredCards = (cards: MTGJSONCard[]) => {
    if (!keywordFilter) return cards;
    
    return cards.filter(card => {
      const keywords = extractKeywords(card.text || '');
      const relevantKeywords = getCommanderRelevantKeywords(keywords);
      return relevantKeywords.some(k => k.toLowerCase().includes(keywordFilter.toLowerCase()));
    });
  };

  // PHASE 2: Check if card is compatible with current commander's color identity
  const isCardColorCompatible = (card: MTGJSONCard): boolean => {
    if (!customDeck.commander) return true; // No commander set, all cards are compatible
    
    const commanderColorIdentity = customDeck.commander.color_identity || [];
    const cardColorIdentity = card.colorIdentity || [];
    
    return commanderRulesService.isCardValidForColorIdentity(
      { color_identity: cardColorIdentity } as ScryfallCard, 
      commanderColorIdentity
    );
  };

  // PHASE 2: Get mana button class based on card colors
  const getManaButtonClass = (card: MTGJSONCard): string => {
    const colorIdentity = card.colorIdentity || [];
    const baseClass = 'text-left p-2 rounded text-sm smooth-transition';
    
    // Handle colorless cards
    if (colorIdentity.length === 0) {
      return `${baseClass} mana-button-colorless`;
    }
    
    // Handle single color cards
    if (colorIdentity.length === 1) {
      const color = colorIdentity[0];
      switch (color) {
        case 'W': return `${baseClass} mana-button-white`;
        case 'U': return `${baseClass} mana-button-blue`;
        case 'B': return `${baseClass} mana-button-black`;
        case 'R': return `${baseClass} mana-button-red`;
        case 'G': return `${baseClass} mana-button-green`;
        default: return `${baseClass} mana-button-colorless`;
      }
    }
    
    // Handle multi-color cards with specific combinations
    const sortedColors = [...colorIdentity].sort();
    const colorKey = sortedColors.join('');
    
    // List of known combinations that have CSS classes
    const knownCombinations = [
      'BG', 'BR', 'BU', 'BW', 'GR', 'GU', 'GW', 'RU', 'RW', 'UW',
      'BGR', 'BGU', 'BGW', 'BRU', 'BRW', 'BUW', 'GRU', 'GRW', 'GUW', 'RUW',
      'BGRU', 'BGRW', 'BGUW', 'BRUW', 'GRUW', 'BGRUW'
    ];
    
    if (knownCombinations.includes(colorKey)) {
      return `${baseClass} mana-button-multicolor-${colorKey}`;
    }
    
    // Fallback to generic multicolor for unknown combinations
    return `${baseClass} mana-button-multicolor`;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold text-white mb-4">Loading Deck Data...</h3>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-400">{Math.round(loadingProgress)}% complete</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-7xl w-full max-h-full overflow-hidden flex">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">
              Deck Analysis ({selectedDecks.length} deck{selectedDecks.length !== 1 ? 's' : ''})
            </h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowCustomDeck(true)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg 
                         transition-colors duration-200 font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                View Custom Deck ({getCardCount()}/100)
              </button>
            </div>
          </div>

          {/* Deck grids */}
          <div className="space-y-8">
            {Array.from(deckData.entries()).map(([deckName, data]) => (
              <div key={deckName} className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-white mb-4">{deckName}</h3>
                
                {/* Commanders section */}
                {data.deck.commander && data.deck.commander.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-lg font-medium text-blue-400 mb-3">
                      Commander{data.deck.commander.length > 1 ? 's' : ''}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {data.deck.commander.map((commander) => {
                        const scryfallCard = data.commanderCards.get(commander.name);
                        return (
                          <div
                            key={commander.name}
                            className="bg-gray-700 rounded-lg p-4 cursor-pointer hover:bg-gray-600 transition-colors"
                            onClick={() => handleCommanderClick(commander.name, deckName)}
                          >
                            {scryfallCard?.image_uris?.normal && (
                              <img
                                src={scryfallCard.image_uris.normal}
                                alt={commander.name}
                                className="w-full h-auto rounded mb-2"
                              />
                            )}
                            <h5 className="font-medium text-white">{commander.name}</h5>
                            {scryfallCard && (
                              <p className="text-sm text-gray-300 mt-2">
                                {scryfallCard.oracle_text}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Main deck cards */}
                <div>
                  {(() => {
                    const filteredCards = getFilteredCards(data.deck.mainBoard);
                    const displayCount = keywordFilter 
                      ? `${filteredCards.length}/${data.deck.mainBoard.length}` 
                      : data.deck.mainBoard.length.toString();
                    
                    return (
                      <>
                        <h4 className="text-lg font-medium text-green-400 mb-3">
                          Deck Cards ({displayCount})
                          {keywordFilter && (
                            <span className="text-xs text-yellow-400 ml-2">
                              filtered by "{keywordFilter}"
                            </span>
                          )}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                          {filteredCards.map((card) => {
                            const isCompatible = isCardColorCompatible(card);
                            const manaButtonClass = getManaButtonClass(card);
                            return (
                              <button
                                key={`${card.name}-${card.uuid}`}
                                className={`${manaButtonClass} transition-colors ${
                                  isCompatible 
                                    ? 'hover:brightness-110' 
                                    : 'opacity-50 cursor-not-allowed brightness-50'
                                }`}
                                onClick={() => isCompatible ? handleCardClick(card, deckName) : undefined}
                                disabled={!isCompatible}
                                title={isCompatible ? undefined : 'Incompatible with commander\'s color identity'}
                              >
                                {card.name}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected card sidebar */}
        {selectedCard && (
          <div className="w-80 bg-gray-800 p-6 overflow-y-auto border-l border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Card Details</h3>
            </div>
            
            {selectedCard.image_uris?.normal && (
              <img
                src={selectedCard.image_uris.normal}
                alt={selectedCard.name}
                className="w-full h-auto rounded mb-4"
              />
            )}
            
            <h4 className="font-bold text-white text-lg mb-2">{selectedCard.name}</h4>
            
            <p className="text-sm text-gray-300 mb-2">
              <span className="font-medium">Type:</span> {selectedCard.type_line}
            </p>
            
            {selectedCard.oracle_text && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-200 mb-1">Oracle Text:</p>
                <p className="text-sm text-gray-300 whitespace-pre-line">
                  {selectedCard.oracle_text}
                </p>
              </div>
            )}

            {/* Add to Deck Buttons */}
            <div className="mb-4 space-y-2">
              <button
                onClick={() => handleAddToCustomDeck(selectedCard, false)}
                className={`w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded 
                         transition-colors duration-200 text-sm font-medium smooth-transition
                         ${showFlareEffect?.includes(selectedCard.id) ? 'neon-flare' : ''}`}
              >
                Add to Deck
              </button>
              
              {selectedCard.types?.includes('Creature') && 
               selectedCard.supertypes?.includes('Legendary') && (
                <button
                  onClick={() => handleAddToCustomDeck(selectedCard, true)}
                  className={`w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded 
                           transition-colors duration-200 text-sm font-medium smooth-transition
                           ${showFireworkEffect?.includes(selectedCard.id) ? 'firework' : ''}`}
                >
                  Set as Commander
                </button>
              )}
            </div>

            {/* Keywords */}
            {selectedCard.oracle_text && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-200 mb-2">Detected Keywords:</p>
                <div className="flex flex-wrap gap-1">
                  {getCardKeywords(selectedCard).map((keyword) => (
                    <button
                      key={keyword}
                      onClick={() => handleKeywordFilter(keyword)}
                      className={`px-2 py-1 text-xs rounded transition-colors duration-200 ${
                        keywordFilter === keyword
                          ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                      title={`Click to filter cards by "${keyword}"`}
                    >
                      {keyword}
                    </button>
                  ))}
                </div>
                {keywordFilter && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-yellow-400">
                      Filtering by: "{keywordFilter}"
                    </span>
                    <button
                      onClick={() => setKeywordFilter(null)}
                      className="text-xs text-gray-400 hover:text-white underline"
                    >
                      Clear filter
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Commander Synergy Section */}
            {selectedCard.types?.includes('Creature') && 
             selectedCard.supertypes?.includes('Legendary') && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-yellow-400">Commander Synergy</p>
                  {!synergyState.isActive ? (
                    <button
                      onClick={handleStartSynergy}
                      className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs"
                    >
                      Start Synergy Analysis
                    </button>
                  ) : (
                    <button
                      onClick={() => setSynergyState(prev => ({ ...prev, isActive: false }))}
                      className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
                    >
                      Close
                    </button>
                  )}
                </div>

                {synergyState.isActive && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-2">Select decks to search for synergies:</p>
                      <div className="space-y-1">
                        {selectedDecks.map(deck => (
                          <label key={deck.name} className="flex items-center text-xs">
                            <input
                              type="checkbox"
                              checked={synergyState.selectedDecks.includes(deck.name)}
                              onChange={() => handleSynergyDeckToggle(deck.name)}
                              className="mr-2"
                            />
                            <span className="text-gray-300">{deck.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {synergyState.selectedDecks.length > 0 && (
                      <button
                        onClick={handleFindSynergyCards}
                        disabled={synergyState.loading}
                        className="w-full px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 
                                 text-white rounded text-sm transition-colors duration-200"
                      >
                        {synergyState.loading ? 'Finding Synergies...' : 'Find Synergistic Cards'}
                      </button>
                    )}

                    {/* Synergy Results */}
                    {synergyState.suggestions.length > 0 && (
                      <div className="max-h-80 overflow-y-auto">
                        <p className="text-sm font-medium text-yellow-400 mb-2">
                          Synergistic Cards ({synergyState.suggestions.length})
                        </p>
                        <p className="text-xs text-gray-400 mb-3">
                          Cards that work well with your commander:
                        </p>
                        <div className="space-y-2">
                          {synergyState.suggestions.slice(0, 15).map((suggestion, index) => (
                            <div key={`synergy-${index}`} className="bg-gray-700 rounded p-2">
                              <div className="flex items-center gap-2">
                                {/* Small card image - click to view card */}
                                {suggestion.card.image_uris?.normal && (
                                  <button
                                    onClick={() => setSelectedCard(suggestion.card)}
                                    className="flex-shrink-0 hover:scale-105 transition-transform"
                                    title="Click to view card"
                                  >
                                    <img
                                      src={suggestion.card.image_uris.normal}
                                      alt={suggestion.card.name}
                                      className="w-12 h-16 object-cover rounded border border-gray-500 hover:border-yellow-400"
                                    />
                                  </button>
                                )}
                                
                                {/* Card info */}
                                <div className="flex-1">
                                  <button
                                    onClick={() => {
                                      setSelectedCard(suggestion.card);
                                    }}
                                    className="text-left w-full hover:bg-gray-600 rounded p-1 transition-colors"
                                  >
                                    <p className="text-xs font-medium text-white">
                                      {suggestion.card.name}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                      From: {suggestion.sourceDeck}
                                    </p>
                                    {/* Commented out synergy explanation per user request */}
                                    {/* <p className="text-xs text-yellow-300">
                                      {suggestion.synergyReasons.join(', ')}
                                    </p> */}
                                    {suggestion.chainedThrough && (
                                      <p className="text-xs text-purple-300 mt-1">
                                        → Works with: {suggestion.chainedThrough}
                                      </p>
                                    )}
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 flex gap-1">
                                <button
                                  onClick={() => handleAddToCustomDeck(suggestion.card, false)}
                                  className={`flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 
                                           text-white rounded text-xs transition-colors duration-200 smooth-transition
                                           ${showFlareEffect?.includes(suggestion.card.id) ? 'neon-flare' : ''}`}
                                >
                                  Add to Deck
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedCard(suggestion.card);
                                  }}
                                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 
                                           text-white rounded text-xs transition-colors duration-200"
                                  title="View card details"
                                >
                                  View
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Color identity */}
            {selectedCard.color_identity && selectedCard.color_identity.length > 0 && (
              <p className="text-sm text-gray-300 mb-2">
                <span className="font-medium">Color Identity:</span> {selectedCard.color_identity.join(', ')}
              </p>
            )}

          </div>
        )}
      </div>

      {/* Custom Deck Modal */}
      {showCustomDeck && (
        <CustomDeckView onClose={() => setShowCustomDeck(false)} />
      )}
    </div>
  );
};
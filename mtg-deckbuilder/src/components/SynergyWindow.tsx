import React, { useState } from 'react';
import type { ScryfallCard } from '../types/scryfall';
import type { GraphSynergyCard } from '../services/graphSynergyService';
import { useCustomDeck } from '../contexts/CustomDeckContext';

interface SynergyWindowProps {
  isOpen: boolean;
  onClose: () => void;
  synergies: GraphSynergyCard[];
  loading: boolean;
  onCardSelect: (card: ScryfallCard) => void;
  commander?: ScryfallCard;
}

export const SynergyWindow: React.FC<SynergyWindowProps> = ({
  isOpen,
  onClose,
  synergies,
  loading,
  onCardSelect,
  commander
}) => {
  const [expandedExplanations, setExpandedExplanations] = useState<Set<string>>(new Set());
  const [showFlareEffect, setShowFlareEffect] = useState<string | null>(null);
  const { addCard } = useCustomDeck();

  // Toggle synergy explanation visibility
  const toggleExplanation = (cardName: string) => {
    setExpandedExplanations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardName)) {
        newSet.delete(cardName);
      } else {
        newSet.add(cardName);
      }
      return newSet;
    });
  };

  const handleAddToCustomDeck = async (card: ScryfallCard, asCommander: boolean = false) => {
    try {
      addCard(card, undefined, asCommander);
      
      // Show flare effect
      setShowFlareEffect(card.id);
      setTimeout(() => setShowFlareEffect(null), 1000);
    } catch (error) {
      console.error('Error adding card to deck:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-11/12 h-5/6 max-w-4xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Synergistic Cards</h2>
            {commander && (
              <span className="text-sm text-gray-400">
                for {commander.name}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
                <p className="text-gray-400">Finding synergistic cards...</p>
              </div>
            </div>
          ) : synergies.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-gray-400 text-lg mb-2">No synergies found</p>
                <p className="text-gray-500 text-sm">Try selecting different decks or a different commander</p>
              </div>
            </div>
          ) : (
            <div className="p-4 h-full overflow-y-auto">
              <div className="mb-4">
                <p className="text-sm font-medium text-yellow-400 mb-2">
                  Found {synergies.length} Synergistic Cards
                </p>
                <p className="text-xs text-gray-400">
                  Cards that work well with your commander
                </p>
              </div>

              <div className="grid gap-3">
                {synergies.map((suggestion, index) => (
                  <div key={`synergy-${index}`} className="bg-gray-700 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      {/* Card image */}
                      {suggestion.card.image_uris?.normal && (
                        <button
                          onClick={() => onCardSelect(suggestion.card)}
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
                          onClick={() => onCardSelect(suggestion.card)}
                          className="text-left w-full hover:bg-gray-600 rounded p-2 transition-colors"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-white">
                              {suggestion.card.name}
                            </p>
                            <span className="text-xs bg-gray-800 text-yellow-300 px-2 py-1 rounded">
                              Score: {suggestion.synergyScore}
                            </span>
                            {suggestion.level === 2 && (
                              <span className="text-xs bg-purple-700 text-white px-2 py-1 rounded">
                                Level 2
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mb-1">
                            From: {suggestion.sourceDeck}
                          </p>
                          {suggestion.chainedThrough && (
                            <p className="text-xs text-purple-300">
                              → Works with: {suggestion.chainedThrough}
                            </p>
                          )}
                        </button>
                        
                        {/* Conditional synergy explanation */}
                        {expandedExplanations.has(suggestion.card.name) && (
                          <div className="mt-2 p-2 bg-gray-800 rounded">
                            <p className="text-xs text-yellow-300">
                              {suggestion.synergyReasons.join(', ')}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {/* Explanation toggle button */}
                      <button
                        onClick={() => toggleExplanation(suggestion.card.name)}
                        className="flex-shrink-0 w-6 h-6 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white 
                                 flex items-center justify-center transition-colors"
                        title={expandedExplanations.has(suggestion.card.name) ? "Hide explanation" : "Show explanation"}
                      >
                        {expandedExplanations.has(suggestion.card.name) ? '−' : '?'}
                      </button>
                    </div>
                    
                    {/* Action buttons */}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleAddToCustomDeck(suggestion.card, false)}
                        className={`flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 
                                 text-white rounded text-sm transition-colors duration-200
                                 ${showFlareEffect?.includes(suggestion.card.id) ? 'animate-pulse' : ''}`}
                      >
                        Add to Deck
                      </button>
                      <button
                        onClick={() => handleAddToCustomDeck(suggestion.card, true)}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition-colors"
                      >
                        As Commander
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
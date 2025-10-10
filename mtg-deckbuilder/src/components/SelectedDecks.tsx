import React from 'react';
import type { PreconDeckSearchResult } from '../types/mtgjson';

interface SelectedDecksProps {
  decks: PreconDeckSearchResult[];
  onRemoveDeck: (deckName: string) => void;
  onAnalyzeDecks: () => void;
}

export const SelectedDecks: React.FC<SelectedDecksProps> = ({ 
  decks, 
  onRemoveDeck, 
  onAnalyzeDecks 
}) => {
  if (decks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p>No decks selected yet. Search and select precon decks above to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">
          Selected Decks ({decks.length})
        </h3>
        
        <button
          onClick={onAnalyzeDecks}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg 
                   transition-colors duration-200 font-medium"
        >
          Analyze Decks
        </button>
      </div>

      <div className="grid gap-3">
        {decks.map((deck) => (
          <div
            key={deck.name}
            className="bg-gray-700 rounded-lg p-4 flex justify-between items-center"
          >
            <div className="flex-1">
              <h4 className="font-medium text-white">{deck.name}</h4>
              {deck.primaryCommander && (
                <p className="text-sm text-blue-400 mt-1">
                  Commander: {deck.primaryCommander}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {deck.theme} • {deck.code}
              </p>
            </div>
            
            <button
              onClick={() => onRemoveDeck(deck.name)}
              className="ml-4 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 
                       rounded transition-colors duration-200"
              title="Remove deck"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
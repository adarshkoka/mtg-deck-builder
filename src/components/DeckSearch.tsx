import React, { useState, useEffect, useRef } from 'react';
import { mtgjsonService } from '../services/mtgjsonService';
import type { PreconDeckSearchResult } from '../types/mtgjson';

interface DeckSearchProps {
  onDeckSelect: (deck: PreconDeckSearchResult) => void;
  selectedDecks: PreconDeckSearchResult[];
  searchHistory?: PreconDeckSearchResult[]; // PHASE 2: Search history
}

export const DeckSearch: React.FC<DeckSearchProps> = ({ onDeckSelect, selectedDecks, searchHistory = [] }) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PreconDeckSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (!query.trim()) {
        setSearchResults([]);
        setIsOpen(false);
        return;
      }

      setIsLoading(true);
      try {
        console.log(`Searching for: "${query}"`);
        const results = await mtgjsonService.searchDecks(query);
        
        // Filter out already selected decks
        const filteredResults = results.filter(
          deck => !selectedDecks.some(selected => selected.name === deck.name)
        );
        
        setSearchResults(filteredResults);
        setIsOpen(filteredResults.length > 0);
        console.log(`Found ${filteredResults.length} available decks`);
      } catch (error) {
        console.error('Failed to search decks:', error);
        setSearchResults([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [query, selectedDecks]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeckSelect = (deck: PreconDeckSearchResult) => {
    onDeckSelect(deck);
    setQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleInputFocus = () => {
    if (searchResults.length > 0) {
      setIsOpen(true);
    }
  };

  return (
    <div className="relative" ref={searchRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder="Search precon decks (e.g., 'Scrappy', 'Caesar', 'Death Toll')"
          className="w-full px-4 py-3 bg-gray-700 text-white border border-gray-600 rounded-lg 
                   focus:border-blue-400 focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50"
        />
        
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
          </div>
        )}
      </div>

      {isOpen && searchResults.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {searchResults.map((deck) => (
            <button
              key={`${deck.code}-${deck.name}`}
              onClick={() => handleDeckSelect(deck)}
              className="w-full px-4 py-3 text-left hover:bg-gray-700 focus:bg-gray-700 
                       focus:outline-none border-b border-gray-700 last:border-b-0"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="font-medium text-white">{deck.name}</div>
                  {deck.primaryCommander && (
                    <div className="text-sm text-blue-400 mt-1">
                      Commander: {deck.primaryCommander}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {deck.theme} • {deck.code} • {deck.releaseDate}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Search History - shown below search */}
      {searchHistory.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Recent Searches</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {searchHistory.slice(0, 4).map((deck) => (
              <button
                key={`history-${deck.code}-${deck.name}`}
                onClick={() => handleDeckSelect(deck)}
                className="p-2 bg-gray-800 border border-gray-600 rounded-lg text-left hover:bg-gray-700 transition-colors"
              >
                <div className="font-medium text-white text-sm">{deck.name}</div>
                <div className="text-xs text-blue-400">
                  {deck.primaryCommander || 'Commander TBD'}
                </div>
                <div className="text-xs text-gray-500">{deck.theme}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
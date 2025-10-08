import { useState } from 'react';
import { DeckSearch } from './components/DeckSearch';
import { SelectedDecks } from './components/SelectedDecks';
import { DeckDisplay } from './components/DeckDisplay';
import { CustomDeckProvider } from './contexts/CustomDeckContext';
import type { PreconDeckSearchResult } from './types/mtgjson';

function App() {
  const [selectedDecks, setSelectedDecks] = useState<PreconDeckSearchResult[]>([]);
  const [showDeckAnalysis, setShowDeckAnalysis] = useState(false);

  const handleDeckSelect = (deck: PreconDeckSearchResult) => {
    // Prevent duplicate selections
    if (!selectedDecks.some(selected => selected.name === deck.name)) {
      setSelectedDecks(prev => [...prev, deck]);
    }
  };

  const handleRemoveDeck = (deckName: string) => {
    setSelectedDecks(prev => prev.filter(deck => deck.name !== deckName));
  };

  const handleAnalyzeDecks = () => {
    if (selectedDecks.length === 0) return;
    setShowDeckAnalysis(true);
  };

  const handleCloseDeckAnalysis = () => {
    setShowDeckAnalysis(false);
  };

  return (
    <CustomDeckProvider>
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <header className="text-center mb-8">
            <h1 className="text-4xl font-bold text-blue-400 mb-2">
              MTG Commander Deckbuilder
            </h1>
            <p className="text-gray-300">
              Search and analyze preconstructed Commander decks
            </p>
          </header>

          <main className="space-y-8">
            {/* Search Section */}
            <section className="bg-gray-800 rounded-lg p-6 shadow-lg">
              <h2 className="text-xl font-semibold mb-4">Search Precon Decks</h2>
              <DeckSearch 
                onDeckSelect={handleDeckSelect}
                selectedDecks={selectedDecks}
              />
              <p className="text-sm text-gray-400 mt-2">
                Try searching for "Caesar", "Scrappy", "Death", or any deck theme
              </p>
            </section>

            {/* Selected Decks Section */}
            <section className="bg-gray-800 rounded-lg p-6 shadow-lg">
              <SelectedDecks
                decks={selectedDecks}
                onRemoveDeck={handleRemoveDeck}
                onAnalyzeDecks={handleAnalyzeDecks}
              />
            </section>
          </main>
        </div>

        {/* Deck Analysis Modal */}
        {showDeckAnalysis && (
          <DeckDisplay
            selectedDecks={selectedDecks}
            onClose={handleCloseDeckAnalysis}
          />
        )}
      </div>
    </CustomDeckProvider>
  );
}

export default App

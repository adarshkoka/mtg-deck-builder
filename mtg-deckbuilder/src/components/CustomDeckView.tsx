import React, { useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { mainService, type FastAPIAnalysisResponse } from '../services/mainService';

interface CustomDeckViewProps {
  onClose: () => void;
}

interface AIAnalysisState {
  isOpen: boolean;
  loading: boolean;
  result: FastAPIAnalysisResponse | null;
  error: string | null;
}

export const CustomDeckView: React.FC<CustomDeckViewProps> = ({ onClose }) => {
  const { customDeck, removeCard, removeCommander, validateDeck, getCardCount } = useCustomDeck();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // PHASE 2: Toggle between grid and list view
  const [aiAnalysisState, setAiAnalysisState] = useState<AIAnalysisState>({
    isOpen: false,
    loading: false,
    result: null,
    error: null
  });
  
  const validation = validateDeck();
  const cardCount = getCardCount();

  const handleRemoveCard = (cardName: string) => {
    removeCard(cardName);
  };

  const handleRemoveCommander = () => {
    removeCommander();
  };

  // AI Analysis handlers
  const handleAnalyzeCustomDeck = async () => {
    if (customDeck.cards.length === 0) {
      alert('Please add some cards to your deck before analyzing.');
      return;
    }

    setAiAnalysisState({
      isOpen: true,
      loading: true,
      result: null,
      error: null
    });

    try {
      // Extract ScryfallCard objects from the custom deck
      const scryfallCards = new Map<string, any>();
      customDeck.cards.forEach(deckCard => {
        scryfallCards.set(deckCard.card.name, deckCard.card);
      });

      const result = await mainService.analyzeCustomDeckCards(scryfallCards);
      setAiAnalysisState(prev => ({
        ...prev,
        loading: false,
        result,
        error: null
      }));
    } catch (error) {
      console.error('AI analysis failed:', error);
      setAiAnalysisState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Analysis failed'
      }));
    }
  };

  const closeAiAnalysis = () => {
    setAiAnalysisState({
      isOpen: false,
      loading: false,
      result: null,
      error: null
    });
  };

  // PHASE 2: Download deck as text file
  const handleDownloadDeck = () => {
    const deckText = generateDeckText();
    const blob = new Blob([deckText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${customDeck.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // PHASE 2: Generate deck text content
  const generateDeckText = (): string => {
    let text = `${customDeck.name}\n\n`;
    
    if (customDeck.commander) {
      text += `Commander:\n1 ${customDeck.commander.name}\n\n`;
    }
    
    const regularCards = customDeck.cards.filter(deckCard => !deckCard.isCommander);
    if (regularCards.length > 0) {
      text += `Main Deck (${regularCards.reduce((sum, card) => sum + card.quantity, 0)} cards):\n`;
      regularCards
        .sort((a, b) => a.card.name.localeCompare(b.card.name))
        .forEach((deckCard, index) => {
          text += `${index + 1}. ${deckCard.quantity > 1 ? `${deckCard.quantity}x ` : ''}${deckCard.card.name}\n`;
        });
    }
    
    text += `\nTotal Cards: ${cardCount + (customDeck.commander ? 1 : 0)}/100\n`;
    text += `Color Identity: ${customDeck.colorIdentity.join('') || 'Colorless'}\n`;
    
    return text;
  };

  const regularCards = customDeck.cards.filter(deckCard => !deckCard.isCommander);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-4xl w-full max-h-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">{customDeck.name}</h2>
            <p className="text-gray-300">
              {cardCount}/100 cards • Color Identity: {customDeck.colorIdentity.join(', ') || 'None'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* AI Analysis Button */}
            {customDeck.cards.length > 0 && (
              <button
                onClick={handleAnalyzeCustomDeck}
                className="px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 
                         text-white rounded transition-all duration-200 flex items-center gap-2"
                title="Analyze deck with AI"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Analysis
              </button>
            )}
            
            {/* PHASE 2: Download Button */}
            {customDeck.cards.length > 0 && (
              <button
                onClick={handleDownloadDeck}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                title="Download deck as text file"
              >
                📄 Download
              </button>
            )}
            
            {/* PHASE 2: View Mode Toggle */}
            <div className="flex bg-gray-700 rounded overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-2 text-sm transition-colors ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 text-sm transition-colors ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
                }`}
              >
                List
              </button>
            </div>
            
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Validation Status */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-3 h-3 rounded-full ${validation.isValid ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="font-medium">
              {validation.isValid ? 'Deck is Commander Legal' : 'Deck has validation errors'}
            </span>
          </div>
          
          {/* Progress bar */}
          <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ${
                cardCount === 100 ? 'bg-green-600' : cardCount > 100 ? 'bg-red-600' : 'bg-blue-600'
              }`}
              style={{ width: `${Math.min((cardCount / 100) * 100, 100)}%` }}
            ></div>
          </div>

          {/* Validation errors */}
          {validation.errors.length > 0 && (
            <div className="space-y-1">
              {validation.errors.slice(0, 3).map((error, index) => (
                <p key={index} className="text-red-400 text-sm">
                  • {error.message}
                </p>
              ))}
              {validation.errors.length > 3 && (
                <p className="text-red-400 text-sm">
                  • And {validation.errors.length - 3} more error{validation.errors.length - 3 !== 1 ? 's' : ''}...
                </p>
              )}
            </div>
          )}

          {/* Validation warnings */}
          {validation.warnings.length > 0 && (
            <div className="space-y-1 mt-2">
              {validation.warnings.slice(0, 2).map((warning, index) => (
                <p key={index} className="text-yellow-400 text-sm">
                  ⚠ {warning.message}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Deck content */}
        <div className="flex-1 overflow-y-auto p-6">
          {customDeck.cards.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-lg mb-2">Your deck is empty</p>
              <p className="text-sm">
                Start by analyzing precon decks and adding cards to build your custom Commander deck.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Commander section */}
              {customDeck.commander && (
                <div>
                  <h3 className="text-lg font-semibold text-blue-400 mb-2">Commander</h3>
                  <div className="bg-gray-800 rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-medium text-white">{customDeck.commander.name}</h4>
                        <p className="text-sm text-gray-300">{customDeck.commander.type_line}</p>
                      </div>
                      <button
                        onClick={handleRemoveCommander}
                        className="ml-4 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                        title="Remove commander"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Main deck */}
              {regularCards.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-green-400 mb-3">
                    Main Deck ({regularCards.reduce((sum, card) => sum + card.quantity, 0)} cards)
                  </h3>
                  
                  {/* PHASE 2: Grid View (4 cards per row) */}
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-4 gap-3">
                      {regularCards
                        .sort((a, b) => a.card.name.localeCompare(b.card.name))
                        .map((deckCard, index) => (
                          <div key={`${deckCard.card.name}-${index}`} className="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-750 transition-colors group">
                            {/* Card Image */}
                            <div className="aspect-[5/7] bg-gray-700 relative">
                              {deckCard.card.image_uris?.normal ? (
                                <img
                                  src={deckCard.card.image_uris.normal}
                                  alt={deckCard.card.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center p-2">
                                  {deckCard.card.name}
                                </div>
                              )}
                              
                              {/* Quantity badge */}
                              {deckCard.quantity > 1 && (
                                <div className="absolute top-1 left-1 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
                                  {deckCard.quantity}x
                                </div>
                              )}
                              
                              {/* Remove button (appears on hover) */}
                              <button
                                onClick={() => handleRemoveCard(deckCard.card.name)}
                                className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title={deckCard.quantity > 1 ? 'Remove one copy' : 'Remove card'}
                              >
                                ×
                              </button>
                            </div>
                            
                            {/* Card Info */}
                            <div className="p-2">
                              <h4 className="text-xs font-medium text-white truncate" title={deckCard.card.name}>
                                {deckCard.card.name}
                              </h4>
                              {deckCard.sourceDeck && (
                                <span className="inline-block text-xs bg-blue-600 text-white px-1 py-0.5 rounded mt-1">
                                  {deckCard.sourceDeck}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    // PHASE 2: List View (original layout)
                    <div className="space-y-2">
                      {regularCards
                        .sort((a, b) => a.card.name.localeCompare(b.card.name))
                        .map((deckCard, index) => (
                          <div key={`${deckCard.card.name}-${index}`} className="bg-gray-800 rounded p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-white">
                                    {deckCard.quantity > 1 ? `${deckCard.quantity}x ` : ''}
                                    {deckCard.card.name}
                                  </span>
                                  {deckCard.sourceDeck && (
                                    <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">
                                      {deckCard.sourceDeck}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-300 mt-1">{deckCard.card.type_line}</p>
                              </div>
                              <button
                                onClick={() => handleRemoveCard(deckCard.card.name)}
                                className="ml-4 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                                title={deckCard.quantity > 1 ? 'Remove one copy' : 'Remove card'}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 bg-gray-800">
          <div className="flex justify-between items-center text-sm text-gray-400">
            <span>
              Total cards: {cardCount}/100 • 
              Commander Legal: {validation.isValid ? 'Yes' : 'No'}
            </span>
            <span>
              Color Identity: {customDeck.colorIdentity.join('') || 'C'}
            </span>
          </div>
        </div>
      </div>

      {/* AI Analysis Modal */}
      {aiAnalysisState.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-700">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Analysis - {customDeck.name}
              </h2>
              <button
                onClick={closeAiAnalysis}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {aiAnalysisState.loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-gray-400 text-lg">Analyzing your deck with AI...</p>
                  <p className="text-gray-500 text-sm mt-2">This may take a few moments</p>
                </div>
              ) : aiAnalysisState.error ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 max-w-md text-center">
                    <svg className="w-12 h-12 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-red-400 mb-2">Analysis Failed</h3>
                    <p className="text-red-300 whitespace-pre-wrap">{aiAnalysisState.error}</p>
                    <button
                      onClick={closeAiAnalysis}
                      className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : aiAnalysisState.result ? (
                <div className="space-y-6">
                  {/* Analysis Summary */}
                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-white">Analysis Summary</h3>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <span>Cards Analyzed: {aiAnalysisState.result.total_found}/{aiAnalysisState.result.total_requested}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="bg-gray-700 rounded p-3">
                        <div className="text-gray-400">Total Cards</div>
                        <div className="text-xl font-bold text-white">{aiAnalysisState.result.total_found}</div>
                      </div>
                      <div className="bg-gray-700 rounded p-3">
                        <div className="text-gray-400">Analysis Status</div>
                        <div className="text-xl font-bold text-green-400">Complete</div>
                      </div>
                      <div className="bg-gray-700 rounded p-3">
                        <div className="text-gray-400">AI Model</div>
                        <div className="text-xl font-bold text-blue-400">Gemini 2.5</div>
                      </div>
                    </div>
                  </div>

                  {/* AI Analysis */}
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      AI Analysis
                    </h3>
                    <div className="prose prose-invert max-w-none">
                      <div className="whitespace-pre-wrap text-gray-300 leading-relaxed">
                        {aiAnalysisState.result.ai_analysis}
                      </div>
                    </div>
                  </div>

                  {/* Cards Analyzed */}
                  <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-3">Cards Analyzed</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                      {aiAnalysisState.result.cards.map((card, index) => (
                        <div key={index} className="bg-gray-700 rounded p-3 text-sm">
                          <div className="font-medium text-white">{card.name}</div>
                          <div className="text-gray-400">{card.type_line}</div>
                          <div className="text-gray-500">{card.mana_cost || 'No cost'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
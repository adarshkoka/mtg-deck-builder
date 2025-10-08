import React, { useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';

interface CustomDeckViewProps {
  onClose: () => void;
}

export const CustomDeckView: React.FC<CustomDeckViewProps> = ({ onClose }) => {
  const { customDeck, removeCard, removeCommander, validateDeck, getCardCount } = useCustomDeck();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // PHASE 2: Toggle between grid and list view
  
  const validation = validateDeck();
  const cardCount = getCardCount();

  const handleRemoveCard = (cardName: string) => {
    removeCard(cardName);
  };

  const handleRemoveCommander = () => {
    removeCommander();
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
    </div>
  );
};
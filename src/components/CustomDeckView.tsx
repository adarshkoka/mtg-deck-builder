import React from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';

interface CustomDeckViewProps {
  onClose: () => void;
}

export const CustomDeckView: React.FC<CustomDeckViewProps> = ({ onClose }) => {
  const { customDeck, removeCard, removeCommander, validateDeck, getCardCount } = useCustomDeck();
  
  const validation = validateDeck();
  const cardCount = getCardCount();

  const handleRemoveCard = (cardName: string) => {
    removeCard(cardName);
  };

  const handleRemoveCommander = () => {
    removeCommander();
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
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
            <div className="space-y-6">
              {/* Commander section */}
              {customDeck.commander && (
                <div>
                  <h3 className="text-lg font-semibold text-blue-400 mb-3">Commander</h3>
                  <div className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-medium text-white">{customDeck.commander.name}</h4>
                        <p className="text-sm text-gray-300 mt-1">{customDeck.commander.type_line}</p>
                        {customDeck.commander.mana_cost && (
                          <p className="text-sm text-gray-400 mt-1">
                            Mana Cost: {customDeck.commander.mana_cost}
                          </p>
                        )}
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
                              {deckCard.card.mana_cost && (
                                <p className="text-sm text-gray-400 mt-1">
                                  {deckCard.card.mana_cost}
                                </p>
                              )}
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
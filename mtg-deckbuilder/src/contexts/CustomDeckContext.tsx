import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { CustomDeck, ValidationError } from '../types/deck';
import type { ScryfallCard } from '../types/deck';
import { commanderRulesService } from '../services/commanderRulesService';

interface CustomDeckContextType {
  customDeck: CustomDeck;
  addCard: (card: ScryfallCard, sourceDeck?: string, asCommander?: boolean) => ValidationError[];
  removeCard: (cardName: string) => void;
  setCommander: (card: ScryfallCard) => ValidationError[];
  removeCommander: () => void;
  clearDeck: () => void;
  validateDeck: () => { isValid: boolean; errors: ValidationError[]; warnings: ValidationError[] };
  getCardCount: () => number;
  // Replace the whole working deck at once (used when loading an AI recommendation or a saved deck).
  replaceDeck: (deck: CustomDeck) => void;
}

// The working deck is kept in the browser (localStorage), so a page refresh keeps it.
// Finished decks are saved on the server (POST /decks); this is only the working copy.
const STORAGE_KEY = 'mtg_custom_deck';

function loadSavedDeck(): CustomDeck | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as CustomDeck) : null;
  } catch {
    return null; // storage blocked or corrupted: start with an empty deck
  }
}

function saveDeck(deck: CustomDeck | null): void {
  try {
    if (deck) localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage full or blocked: the deck still works, it just won't survive a refresh
  }
}

const CustomDeckContext = createContext<CustomDeckContextType | undefined>(undefined);

// The hook lives next to its provider on purpose; the only cost is that editing this file
// reloads the page instead of hot-swapping during development.
// eslint-disable-next-line react-refresh/only-export-components
export const useCustomDeck = () => {
  const context = useContext(CustomDeckContext);
  if (!context) {
    throw new Error('useCustomDeck must be used within a CustomDeckProvider');
  }
  return context;
};

interface CustomDeckProviderProps {
  children: ReactNode;
}

export const CustomDeckProvider: React.FC<CustomDeckProviderProps> = ({ children }) => {
  // Load the working deck from localStorage when the app starts
  const [customDeck, setCustomDeck] = useState<CustomDeck>(() => {
    const savedDeck = loadSavedDeck();
    return savedDeck || {
      name: 'My Custom Deck',
      cards: [],
      colorIdentity: []
    };
  });

  // Save every change to localStorage
  useEffect(() => {
    saveDeck(customDeck);
  }, [customDeck]);

  const addCard = (card: ScryfallCard, sourceDeck?: string, asCommander: boolean = false): ValidationError[] => {
    // Validate the addition first
    const validationErrors = commanderRulesService.validateCardAddition(card, customDeck, asCommander);
    
    if (validationErrors.length > 0) {
      return validationErrors;
    }

    setCustomDeck(prev => {
      if (asCommander) {
        return {
          ...prev,
          commander: card,
          colorIdentity: card.color_identity || [],
          cards: [
            ...prev.cards,
            {
              card,
              quantity: 1,
              isCommander: true,
              sourceDeck
            }
          ]
        };
      } else {
        // Check if card already exists (for basic lands, increment quantity)
        const existingCardIndex = prev.cards.findIndex(
          deckCard => deckCard.card.name === card.name && !deckCard.isCommander
        );

        const isBasicLand = card.supertypes?.includes('Basic') && card.types?.includes('Land');

        if (existingCardIndex >= 0 && isBasicLand) {
          // Increment quantity for basic lands
          const updatedCards = [...prev.cards];
          updatedCards[existingCardIndex] = {
            ...updatedCards[existingCardIndex],
            quantity: updatedCards[existingCardIndex].quantity + 1
          };
          return { ...prev, cards: updatedCards };
        } else {
          // Add new card
          return {
            ...prev,
            cards: [
              ...prev.cards,
              {
                card,
                quantity: 1,
                isCommander: false,
                sourceDeck
              }
            ]
          };
        }
      }
    });

    return [];
  };

  const removeCard = (cardName: string) => {
    setCustomDeck(prev => {
      const cardIndex = prev.cards.findIndex(
        deckCard => deckCard.card.name === cardName && !deckCard.isCommander
      );

      if (cardIndex >= 0) {
        const card = prev.cards[cardIndex];
        if (card.quantity > 1) {
          // Decrease quantity
          const updatedCards = [...prev.cards];
          updatedCards[cardIndex] = {
            ...updatedCards[cardIndex],
            quantity: card.quantity - 1
          };
          return { ...prev, cards: updatedCards };
        } else {
          // Remove card entirely
          return {
            ...prev,
            cards: prev.cards.filter((_, index) => index !== cardIndex)
          };
        }
      }

      return prev;
    });
  };

  const setCommander = (card: ScryfallCard): ValidationError[] => {
    const validationErrors = commanderRulesService.validateCardAddition(card, customDeck, true);
    
    if (validationErrors.length > 0) {
      return validationErrors;
    }

    setCustomDeck(prev => ({
      ...prev,
      commander: card,
      colorIdentity: card.color_identity || [],
      cards: [
        ...prev.cards.filter(deckCard => !deckCard.isCommander),
        {
          card,
          quantity: 1,
          isCommander: true
        }
      ]
    }));

    return [];
  };

  const removeCommander = () => {
    setCustomDeck(prev => ({
      ...prev,
      commander: undefined,
      colorIdentity: [],
      cards: prev.cards.filter(deckCard => !deckCard.isCommander)
    }));
  };

  const clearDeck = () => {
    const emptyDeck = {
      name: 'My Custom Deck',
      cards: [],
      colorIdentity: []
    };
    setCustomDeck(emptyDeck);
    saveDeck(null);
  };

  const validateDeck = () => {
    const validation = commanderRulesService.validateDeck(customDeck);
    return {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings
    };
  };

  // Total cards including the commander (a finished deck has exactly 100).
  const getCardCount = (): number => {
    return customDeck.cards.reduce((total, deckCard) => total + deckCard.quantity, 0);
  };

  const replaceDeck = (deck: CustomDeck) => {
    setCustomDeck(deck);
  };

  const value: CustomDeckContextType = {
    customDeck,
    addCard,
    removeCard,
    setCommander,
    removeCommander,
    clearDeck,
    validateDeck,
    getCardCount,
    replaceDeck
  };

  return (
    <CustomDeckContext.Provider value={value}>
      {children}
    </CustomDeckContext.Provider>
  );
};
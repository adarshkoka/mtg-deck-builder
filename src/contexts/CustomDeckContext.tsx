import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { CustomDeck, ValidationError } from '../types/customDeck';
import type { ScryfallCard } from '../types/scryfall';
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
}

const CustomDeckContext = createContext<CustomDeckContextType | undefined>(undefined);

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
  const [customDeck, setCustomDeck] = useState<CustomDeck>({
    name: 'My Custom Deck',
    cards: [],
    colorIdentity: []
  });

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
    setCustomDeck({
      name: 'My Custom Deck',
      cards: [],
      colorIdentity: []
    });
  };

  const validateDeck = () => {
    const validation = commanderRulesService.validateDeck(customDeck);
    return {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings
    };
  };

  const getCardCount = (): number => {
    return customDeck.cards.reduce((total, deckCard) => {
      return deckCard.isCommander ? total : total + deckCard.quantity;
    }, 0);
  };

  const value: CustomDeckContextType = {
    customDeck,
    addCard,
    removeCard,
    setCommander,
    removeCommander,
    clearDeck,
    validateDeck,
    getCardCount
  };

  return (
    <CustomDeckContext.Provider value={value}>
      {children}
    </CustomDeckContext.Provider>
  );
};
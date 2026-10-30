// "Find synergistic cards": owned cards that fit the commander, from the server's hybrid
// search (meaning + keywords, no LLM call). Each result says which method matched it.

import { useEffect, useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { api } from '../services/api';
import { toScryfallCard } from '../services/cardMapper';
import { useCardPreview } from '../hooks/useCardPreview';
import type { OwnedCard, SynergyResult } from '../types/backend';

interface Props {
  collectionId: number;
  commander: OwnedCard;
  onClose: () => void;
}

export function SynergyWindow({ collectionId, commander, onClose }: Props) {
  const { addCard } = useCustomDeck();
  const [theme, setTheme] = useState('');
  const [submittedTheme, setSubmittedTheme] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<SynergyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [flare, setFlare] = useState<string | null>(null);
  const { bind, preview } = useCardPreview();

  useEffect(() => {
    setResult(null);
    api
      .synergy(collectionId, commander.name, submittedTheme)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [collectionId, commander.name, submittedTheme]);

  const handleAdd = (card: OwnedCard) => {
    const errors = addCard(toScryfallCard(card));
    if (errors.length === 0) {
      setFlare(card.scryfall_id); // a brief burgundy glow (.added-glow in index.css)
      setTimeout(() => setFlare(null), 700);
    }
    setFeedback((prev) => ({ ...prev, [card.scryfall_id]: errors.length ? errors[0].message : 'Added' }));
  };

  return (
    <div className="backdrop">
      <div className="frame sheet flex max-h-[90vh] w-full max-w-5xl flex-col p-0">
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4">
          <div className="flex-1">
            <h2 className="section-title">Cards that Fit {commander.name}</h2>
            {result && (
              <p className="mt-1 text-mahogany-500">
                {result.semantic
                  ? 'Matched by meaning and keywords'
                  : 'Keyword matching only (enable smart search on the Collection tab)'}
              </p>
            )}
          </div>
          <button className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>

        <form
          className="flex gap-2 px-7 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedTheme(theme.trim() || undefined);
          }}
        >
          <input
            className="field flex-1"
            placeholder="Optional extra theme, e.g. 'sacrifice creatures for value'"
            aria-label="Extra theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
          <button className="btn btn-primary">Search</button>
        </form>

        <div className="flex-1 overflow-y-auto px-7 pb-7">
          {error && <p className="notice notice-error">{error}</p>}
          {!result && !error && <p className="text-mahogany-500">Searching…</p>}
          {result?.cards.length === 0 && <p className="text-mahogany-500">No matching cards found.</p>}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {result?.cards.map(({ card, matched_by }) => (
              <div key={card.scryfall_id} className={`panel p-2 ${flare === card.scryfall_id ? 'added-glow' : ''}`}>
                {card.image_url ? (
                  <img src={card.image_url} alt={card.name} className="card-img card-pop w-full" loading="lazy" {...bind(card.image_url)} />
                ) : (
                  <div className="aspect-[5/7] p-2">{card.name}</div>
                )}
                <div className="mt-2 space-y-2">
                  <div className="flex gap-1">
                    {matched_by.map((m) => (
                      <span key={m} className="tag">
                        {m}
                      </span>
                    ))}
                  </div>
                  <button className="btn btn-primary btn-sm w-full" onClick={() => handleAdd(card)}>
                    Add to Deck
                  </button>
                  {feedback[card.scryfall_id] && <p className="text-sm text-mahogany-600">{feedback[card.scryfall_id]}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {preview}
    </div>
  );
}

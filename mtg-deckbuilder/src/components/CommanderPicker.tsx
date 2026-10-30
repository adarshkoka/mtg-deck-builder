// Step 2: pick a commander from the legendary creatures the user owns.

import { useEffect, useState } from 'react';
import { useCardPreview } from '../hooks/useCardPreview';
import { api } from '../services/api';
import type { OwnedCard } from '../types/backend';

interface Props {
  collectionId: number;
  selected: OwnedCard | null;
  onSelect: (commander: OwnedCard) => void;
}

export function CommanderPicker({ collectionId, selected, onSelect }: Props) {
  const [commanders, setCommanders] = useState<OwnedCard[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { bind, preview } = useCardPreview();

  useEffect(() => {
    setCommanders(null);
    api
      .commanders(collectionId)
      .then(setCommanders)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [collectionId]);

  const shown = (commanders ?? []).filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="frame">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h2 className="section-title flex-1">Choose a Commander</h2>
        <input
          className="field w-64"
          placeholder="Filter by name"
          aria-label="Filter commanders by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {error && <p className="notice notice-error">{error}</p>}
      {commanders === null && !error && <p className="text-mahogany-500">Loading…</p>}
      {commanders?.length === 0 && <p className="text-mahogany-500">No legendary creatures in this collection.</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {shown.map((card) => {
          const chosen = selected?.name === card.name;
          return (
            <button key={card.scryfall_id} onClick={() => onSelect(card)} className="card-pop text-left" {...bind(card.image_url)}>
              {card.image_url ? (
                <img
                  src={card.image_url}
                  alt={card.name}
                  className={`card-img w-full ${chosen ? 'outline-2 outline-offset-4 outline-burgundy-600' : ''}`}
                  loading="lazy"
                />
              ) : (
                <div className="panel flex aspect-[5/7] items-center justify-center p-2 text-center">{card.name}</div>
              )}
              {chosen && <span className="seal mt-2">Chosen commander</span>}
            </button>
          );
        })}
      </div>
      {preview}
    </section>
  );
}

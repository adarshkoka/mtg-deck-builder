// Manual deck building: browse and filter the collection, then add cards to the deck.
//
// Filtering happens on the server (GET /collections/{id}/cards with query parameters), so
// even a 10,000-card collection only sends one page of results to the browser.

import { useEffect, useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { useCardPreview } from '../hooks/useCardPreview';
import { api } from '../services/api';
import { toScryfallCard } from '../services/cardMapper';
import type { CardFilters, OwnedCard, OwnedCardsPage } from '../types/backend';

const PAGE_SIZE = 60;

interface Props {
  collectionId: number;
  commander: OwnedCard | null;
  onShowSynergy: () => void;
}

export function CardBrowser({ collectionId, commander, onShowSynergy }: Props) {
  const [filters, setFilters] = useState<CardFilters>({});
  const [onlyCommanderColors, setOnlyCommanderColors] = useState(true);
  const [page, setPage] = useState<OwnedCardsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<OwnedCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { bind, preview } = useCardPreview();

  // Re-query whenever the filters or the page change. A short delay (debounce) means
  // typing "elf" sends one request instead of three.
  useEffect(() => {
    const query: CardFilters = {
      ...filters,
      identity_within: onlyCommanderColors && commander ? commander.color_identity : undefined,
    };
    const timer = setTimeout(() => {
      api
        .searchCards(collectionId, query, PAGE_SIZE, offset)
        .then((result) => {
          setPage(result);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [collectionId, filters, onlyCommanderColors, commander, offset]);

  const update = (patch: Partial<CardFilters>) => {
    setOffset(0); // a new filter starts again from the first page
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const numberOrUndefined = (value: string) => (value === '' ? undefined : Number(value));

  return (
    <div className="flex gap-6">
      <section className="frame flex-1">
        <h2 className="section-title mb-5">Your Collection</h2>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <input className="field" placeholder="Name" aria-label="Card name" onChange={(e) => update({ name: e.target.value || undefined })} />
          <input
            className="field"
            placeholder="Rules text, e.g. draw"
            aria-label="Rules text"
            onChange={(e) => update({ text: e.target.value || undefined })}
          />
          <input
            className="field w-40"
            placeholder="Type, e.g. Creature"
            aria-label="Type"
            onChange={(e) => update({ type_line: e.target.value || undefined })}
          />
          <input
            className="field w-24"
            type="number"
            min={0}
            placeholder="Min MV"
            aria-label="Minimum mana value"
            onChange={(e) => update({ min_cmc: numberOrUndefined(e.target.value) })}
          />
          <input
            className="field w-24"
            type="number"
            min={0}
            placeholder="Max MV"
            aria-label="Maximum mana value"
            onChange={(e) => update({ max_cmc: numberOrUndefined(e.target.value) })}
          />
          {commander && (
            <label className="flex items-center gap-2 text-mahogany-600">
              <input
                type="checkbox"
                checked={onlyCommanderColors}
                onChange={(e) => {
                  setOffset(0);
                  setOnlyCommanderColors(e.target.checked);
                }}
              />
              Only {commander.name}'s colors
            </label>
          )}
          {commander && (
            <button className="btn btn-secondary ml-auto" onClick={onShowSynergy}>
              Find Synergistic Cards
            </button>
          )}
        </div>

        {error && <p className="notice notice-error">{error}</p>}
        {page && (
          <>
            <p className="mb-3 text-mahogany-500">
              {page.total} matching cards · showing {page.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, page.total)}
            </p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {page.cards.map((card) => (
                <button key={card.scryfall_id} onClick={() => setSelected(card)} className="card-pop" {...bind(card.image_url)}>
                  {card.image_url ? (
                    // The "normal" image (488px wide): the 146px "small" one looks blurry at this size.
                    <img
                      src={card.image_url}
                      alt={card.name}
                      className={`card-img w-full ${
                        selected?.scryfall_id === card.scryfall_id ? 'outline-2 outline-offset-4 outline-burgundy-600' : ''
                      }`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="panel aspect-[5/7] p-2 text-sm">{card.name}</div>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <button className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={offset + PAGE_SIZE >= page.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
      {selected && <CardDetail card={selected} onClose={() => setSelected(null)} />}
      {preview}
    </div>
  );
}

// The side panel for one card: full text and the "add" buttons.
export function CardDetail({ card, onClose }: { card: OwnedCard; onClose: () => void }) {
  const { addCard, customDeck } = useCustomDeck();
  const [messages, setMessages] = useState<string[]>([]);
  const canLead = /Legendary/.test(card.type_line) && /Creature/.test(card.type_line);

  const add = (asCommander: boolean) => {
    // The deck context validates singleton, color identity, and size, and says why not.
    const errors = addCard(toScryfallCard(card), undefined, asCommander);
    setMessages(errors.length ? errors.map((e) => e.message) : [asCommander ? 'Set as commander.' : 'Added to deck.']);
  };

  return (
    <aside className="frame sticky top-4 w-80 shrink-0 self-start p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-xl leading-tight text-burgundy-700">{card.name}</h3>
        <button className="btn btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {/* Actions first, so they can be reached without scrolling past the card image. */}
      <div className="mb-3 flex gap-2">
        <button className="btn btn-primary flex-1" onClick={() => add(false)}>
          Add to Deck
        </button>
        {canLead && !customDeck.commander && (
          <button className="btn btn-secondary flex-1" onClick={() => add(true)}>
            Set as Commander
          </button>
        )}
      </div>
      {messages.map((m) => (
        <p key={m} className="notice mb-3 text-sm">
          {m}
        </p>
      ))}
      {card.image_url && <img src={card.image_url} alt={card.name} className="card-img mb-4 w-full" />}
      <p className="text-mahogany-600">
        {card.mana_cost} · {card.type_line}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-mahogany-900">{card.oracle_text}</p>
      <p className="mt-3 text-sm text-mahogany-500">
        Owned: {card.quantity} · {card.set_code.toUpperCase()} #{card.collector_number}
        {!card.legal_in_commander && <span className="text-burgundy-700"> · not legal in Commander</span>}
      </p>
    </aside>
  );
}

// Step 4: decks the user approved and saved on the server.

import { useCallback, useEffect, useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { api } from '../services/api';
import { buildWorkingDeck } from '../services/cardMapper';
import { useCardPreview } from '../hooks/useCardPreview';
import type { CardPick, OwnedCard, Role, SavedDeck } from '../types/backend';
import { ROLE_LABELS } from '../types/backend';
import { downloadMoxfieldFile } from '../services/exportDeck';

interface Props {
  collectionId: number;
  refreshKey: number; // changes whenever a deck is saved elsewhere, to reload the list
  onOpenBuilder: () => void;
}

export function SavedDecks({ collectionId, refreshKey, onOpenBuilder }: Props) {
  const { replaceDeck } = useCustomDeck();
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  // Card images for opened decks, fetched once per deck: deck id -> name -> card.
  const [cardData, setCardData] = useState<Record<number, Record<string, OwnedCard>>>({});
  const { bind, preview } = useCardPreview();

  const toggleOpen = (deck: SavedDeck) => {
    const opening = open !== deck.id;
    setOpen(opening ? deck.id : null);
    if (opening && !cardData[deck.id]) {
      api
        .lookupCards(collectionId, [deck.commander, ...deck.cards.map((c) => c.name)])
        .then((cards) => setCardData((prev) => ({ ...prev, [deck.id]: Object.fromEntries(cards.map((c) => [c.name, c])) })))
        .catch(() => setCardData((prev) => ({ ...prev, [deck.id]: {} })));
    }
  };

  const load = useCallback(() => {
    api
      .listDecks(collectionId)
      .then(setDecks)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [collectionId]);

  useEffect(load, [load, refreshKey]);

  const loadIntoBuilder = async (deck: SavedDeck) => {
    const [commander] = await api.lookupCards(collectionId, [deck.commander]);
    if (!commander) {
      setError(`${deck.commander} is no longer in this collection`);
      return;
    }
    replaceDeck(await buildWorkingDeck(collectionId, deck.name, commander, deck.cards.map((c) => c.name), deck.basic_lands));
    onOpenBuilder();
  };

  const remove = async (deck: SavedDeck) => {
    if (!confirm(`Delete "${deck.name}"?`)) return;
    await api.deleteDeck(deck.id);
    load();
  };

  return (
    <section className="frame">
      <h2 className="section-title mb-5">Saved Decks</h2>
      {error && <p className="notice notice-error mb-3">{error}</p>}
      {decks.length === 0 && (
        <p className="text-mahogany-500">No saved decks yet. Use Construct Deck to build one, then save it.</p>
      )}
      <ul className="space-y-3">
        {decks.map((deck) => (
          <li key={deck.id} className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button className="text-left" onClick={() => toggleOpen(deck)} aria-expanded={open === deck.id}>
                <div className="text-xl text-burgundy-700">{deck.name}</div>
                <div className="text-sm text-mahogany-500">
                  {deck.commander} · {deck.card_count}/100 cards {deck.complete ? '· complete' : '· incomplete'} ·{' '}
                  {new Date(deck.created_at + 'Z').toLocaleString()}
                </div>
              </button>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => void loadIntoBuilder(deck)}>
                  Open
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  title="Download a .txt file Moxfield can import"
                  onClick={() =>
                    downloadMoxfieldFile({
                      name: deck.name,
                      commander: deck.commander,
                      cards: deck.cards.map((c) => c.name),
                      basicLands: deck.basic_lands,
                    })
                  }
                >
                  Export to Moxfield
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => void remove(deck)}>
                  Delete
                </button>
              </div>
            </div>
            {open === deck.id && (
              <div className="mt-4 space-y-4 border-t border-mahogany-700/30 pt-4">
                <label className="flex items-center gap-2 text-mahogany-600">
                  <input type="checkbox" checked={showReasons} onChange={(e) => setShowReasons(e.target.checked)} />
                  Show as a list with the reason for each card
                </label>
                {showReasons ? (
                  <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                    {deck.cards.map((card) => (
                      <li key={card.name} {...bind(cardData[deck.id]?.[card.name]?.image_url)}>
                        <span className="label mr-2 inline">{ROLE_LABELS[card.role]}</span>
                        <span className="text-mahogany-900">{card.name}</span>
                        <span className="text-mahogany-500"> — {card.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <DeckImages deck={deck} cards={cardData[deck.id]} bind={bind} />
                )}
                <p className="text-mahogany-600">
                  <span className="label inline">Basic lands</span>{' '}
                  {Object.entries(deck.basic_lands)
                    .map(([land, n]) => `${n} ${land}`)
                    .join(', ') || 'none'}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {preview}
    </section>
  );
}

// The deck's cards as images, grouped by role, with the commander first.
function DeckImages({
  deck,
  cards,
  bind,
}: {
  deck: SavedDeck;
  cards: Record<string, OwnedCard> | undefined;
  bind: ReturnType<typeof useCardPreview>['bind'];
}) {
  if (!cards) return <p className="text-mahogany-500">Loading cards…</p>;
  const byRole = new Map<Role, CardPick[]>();
  for (const pick of deck.cards) byRole.set(pick.role, [...(byRole.get(pick.role) ?? []), pick]);
  const groups: [string, string[]][] = [
    ['Commander', [deck.commander]],
    ...[...byRole.entries()].map(([role, picks]): [string, string[]] => [ROLE_LABELS[role], picks.map((p) => p.name)]),
  ];
  return (
    <div className="space-y-5">
      {groups.map(([label, names]) => (
        <section key={label}>
          <h4 className="group-title mb-3">
            {label} ({names.length})
          </h4>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {names.map((name) => {
              const card = cards[name];
              return card?.image_url ? (
                <img
                  key={name}
                  src={card.image_url}
                  alt={name}
                  className="card-img card-pop w-full"
                  loading="lazy"
                  {...bind(card.image_url)}
                />
              ) : (
                <div key={name} className="panel flex aspect-[5/7] items-center justify-center p-1 text-center text-sm">
                  {name}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

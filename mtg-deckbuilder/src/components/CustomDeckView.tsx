// The working deck in a large window: every card at a glance (image grid or compact
// list, grouped by card type), deck validation, Moxfield export, and the AI analysis.
// Hovering any card shows a large, readable copy of it.

import { useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { useCardPreview } from '../hooks/useCardPreview';
import { analyzeDeckCards } from '../services/api';
import { downloadMoxfieldFile } from '../services/exportDeck';
import type { CardAnalysis } from '../types/backend';
import type { CustomDeckCard, ScryfallCard } from '../types/deck';

interface Props {
  onClose: () => void;
}

// Display order of card-type groups. A card goes in the first group its type line matches.
const TYPE_GROUPS = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];

function groupByType(cards: CustomDeckCard[]): [string, CustomDeckCard[]][] {
  const groups = new Map<string, CustomDeckCard[]>();
  for (const deckCard of [...cards].sort((a, b) => a.card.name.localeCompare(b.card.name))) {
    const type = TYPE_GROUPS.find((t) => deckCard.card.type_line.includes(t)) ?? 'Other';
    groups.set(type, [...(groups.get(type) ?? []), deckCard]);
  }
  return [...TYPE_GROUPS, 'Other'].filter((t) => groups.has(t)).map((t) => [t, groups.get(t)!]);
}

type Analysis = { loading: boolean; result: CardAnalysis | null; error: string | null };

export function CustomDeckView({ onClose }: Props) {
  const { customDeck, removeCard, removeCommander, validateDeck, getCardCount } = useCustomDeck();
  const { bind, preview } = useCardPreview();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const validation = validateDeck();
  const cardCount = getCardCount();
  const mainCards = customDeck.cards.filter((c) => !c.isCommander);
  const groups = groupByType(mainCards);

  const runAnalysis = async () => {
    setAnalysis({ loading: true, result: null, error: null });
    try {
      const cards = new Map<string, ScryfallCard>(customDeck.cards.map((c) => [c.card.name, c.card]));
      setAnalysis({ loading: false, result: await analyzeDeckCards(cards), error: null });
    } catch (err) {
      setAnalysis({ loading: false, result: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const exportDeck = () => {
    if (!customDeck.commander) return;
    const basics: Record<string, number> = {};
    const names: string[] = [];
    for (const { card, quantity } of mainCards) {
      if (card.supertypes?.includes('Basic')) basics[card.name] = (basics[card.name] ?? 0) + quantity;
      else names.push(card.name);
    }
    downloadMoxfieldFile({ name: customDeck.name, commander: customDeck.commander.name, cards: names, basicLands: basics });
  };

  return (
    <div className="backdrop">
      <div className="frame sheet flex h-[94vh] w-full max-w-[96rem] flex-col p-0">
        {/* Header: name, count, actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-mahogany-700/30 px-7 pt-6 pb-4">
          <div>
            <h2 className="text-3xl text-burgundy-700">{customDeck.name}</h2>
            <p className="text-mahogany-500">
              {cardCount}/100 cards · Color identity: {customDeck.colorIdentity.join('') || 'colorless'} ·{' '}
              <span className={validation.isValid ? 'text-mahogany-800' : 'text-burgundy-700'}>
                {validation.isValid ? 'Commander legal' : `${validation.errors.length} problem(s)`}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {customDeck.cards.length > 0 && (
              <button onClick={() => void runAnalysis()} className="btn btn-secondary btn-sm">
                AI Analysis
              </button>
            )}
            {customDeck.commander && (
              <button onClick={exportDeck} className="btn btn-secondary btn-sm" title="Download a .txt file Moxfield can import">
                Export to Moxfield
              </button>
            )}
            <div className="flex" role="group" aria-label="View">
              {(['grid', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className="tab px-3 py-1 text-sm"
                >
                  {mode === 'grid' ? 'Grid' : 'List'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="btn btn-quiet">
              Close
            </button>
          </div>
        </div>

        {/* Validation problems (first few) */}
        {validation.errors.length > 0 && (
          <div className="notice notice-error mx-7 mt-3 space-y-0.5 text-sm">
            {validation.errors.slice(0, 3).map((e) => (
              <p key={e.message}>{e.message}</p>
            ))}
            {validation.errors.length > 3 && <p>…and {validation.errors.length - 3} more</p>}
          </div>
        )}

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-7 py-5">
          {customDeck.cards.length === 0 ? (
            <p className="py-12 text-center text-mahogany-500">
              Your deck is empty. Pick a commander, then use Construct Deck or add cards from the Browse tab.
            </p>
          ) : (
            <div className="flex gap-6">
              {/* Commander, always visible on the left */}
              {customDeck.commander && (
                <div className="w-40 shrink-0">
                  <h3 className="group-title mb-3">Commander</h3>
                  <div className="group relative">
                    <CardImage card={customDeck.commander} bind={bind} />
                    <RemoveButton onClick={removeCommander} label="Remove commander" />
                  </div>
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-6">
                {groups.map(([type, cards]) => (
                  <section key={type}>
                    <h3 className="group-title mb-3">
                      {type} ({cards.reduce((n, c) => n + c.quantity, 0)})
                    </h3>
                    {viewMode === 'grid' ? (
                      // Small images, many per row: a whole deck fits in a few screens.
                      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10">
                        {cards.map((deckCard) => (
                          <div key={deckCard.card.name} className="group relative">
                            <CardImage card={deckCard.card} bind={bind} />
                            {deckCard.quantity > 1 && (
                              <span className="seal pointer-events-none absolute top-1 left-1 z-30">{deckCard.quantity}x</span>
                            )}
                            <RemoveButton
                              onClick={() => removeCard(deckCard.card.name)}
                              label={deckCard.quantity > 1 ? 'Remove one copy' : 'Remove card'}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      // One short line per card, in several columns.
                      <ul className="columns-1 gap-8 sm:columns-2 lg:columns-3 xl:columns-4">
                        {cards.map((deckCard) => (
                          <li
                            key={deckCard.card.name}
                            className="group flex break-inside-avoid items-center justify-between gap-2 px-2 py-0.5 hover:bg-ivory-300/60"
                            {...bind(deckCard.card.image_uris?.normal)}
                          >
                            <span className="truncate text-mahogany-900">
                              {deckCard.quantity > 1 && <span className="text-burgundy-700">{deckCard.quantity}x </span>}
                              {deckCard.card.name}
                              <span className="ml-2 text-sm text-mahogany-400">{deckCard.card.mana_cost}</span>
                            </span>
                            <button
                              onClick={() => removeCard(deckCard.card.name)}
                              className="btn btn-quiet btn-sm py-0 opacity-0 group-hover:opacity-100"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {preview}
      {analysis && <AnalysisModal analysis={analysis} deckName={customDeck.name} onClose={() => setAnalysis(null)} />}
    </div>
  );
}

// Appears on a card when hovered; removes it (or one copy) from the deck.
function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="seal absolute bottom-2 left-1/2 z-30 -translate-x-1/2 cursor-pointer opacity-0 group-hover:opacity-100"
    >
      Remove
    </button>
  );
}

function CardImage({ card, bind }: { card: ScryfallCard; bind: ReturnType<typeof useCardPreview>['bind'] }) {
  // The "normal" image (488px wide): the 146px "small" one looks blurry at grid size.
  const src = card.image_uris?.normal ?? card.image_uris?.small;
  return src ? (
    <img src={src} alt={card.name} className="card-img card-pop w-full" loading="lazy" {...bind(card.image_uris?.normal)} />
  ) : (
    <div className="panel flex aspect-[5/7] items-center justify-center p-1 text-center text-sm">{card.name}</div>
  );
}

function AnalysisModal({ analysis, deckName, onClose }: { analysis: Analysis; deckName: string; onClose: () => void }) {
  return (
    <div className="backdrop z-[60]">
      <div className="frame sheet flex max-h-[90vh] w-full max-w-4xl flex-col p-0">
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4">
          <h2 className="section-title flex-1">AI Analysis: {deckName}</h2>
          <button onClick={onClose} className="btn btn-quiet">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 pb-7">
          {analysis.loading && <p className="animate-pulse text-mahogany-500">Analyzing your deck…</p>}
          {analysis.error && <p className="notice notice-error whitespace-pre-wrap">Analysis failed: {analysis.error}</p>}
          {analysis.result && (
            <>
              <p className="mb-4 text-sm text-mahogany-500">
                Analyzed {analysis.result.total_found} of {analysis.result.total_requested} cards (the first 20 with a
                multiverse id).
              </p>
              <div className="whitespace-pre-wrap text-lg leading-relaxed text-mahogany-900">{analysis.result.ai_analysis}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

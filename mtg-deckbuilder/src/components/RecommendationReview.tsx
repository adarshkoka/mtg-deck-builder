// The human-in-the-loop step: the user reviews every AI pick (grouped by role, each with
// its reason), accepts or rejects it, and either asks the agent to revise or saves.

import { useEffect, useMemo, useState } from 'react';
import type { DeckRecommendation, OwnedCard, Role } from '../types/backend';
import { ROLE_LABELS } from '../types/backend';
import { useCardPreview } from '../hooks/useCardPreview';
import { downloadMoxfieldFile } from '../services/exportDeck';

export type Decision = 'accept' | 'reject';

interface Props {
  recommendation: DeckRecommendation;
  cardInfo: Record<string, OwnedCard>; // full card data by name, for images and text
  busy: boolean;
  onRevise: (accepted: string[], rejected: string[], feedback: string) => void;
  onSave: (name: string, accepted: string[]) => void;
  onLoadIntoBuilder: (accepted: string[]) => void;
}

export function RecommendationReview({ recommendation, cardInfo, busy, onRevise, onSave, onLoadIntoBuilder }: Props) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [feedback, setFeedback] = useState('');
  const [deckName, setDeckName] = useState(`${recommendation.commander} deck`);
  const { bind, preview } = useCardPreview();

  // A new recommendation starts with every card accepted.
  useEffect(() => {
    setDecisions(Object.fromEntries(recommendation.picks.map((p) => [p.name, 'accept' as Decision])));
  }, [recommendation]);

  const byRole = useMemo(() => {
    const groups = new Map<Role, typeof recommendation.picks>();
    for (const pick of recommendation.picks) {
      groups.set(pick.role, [...(groups.get(pick.role) ?? []), pick]);
    }
    return [...groups.entries()];
  }, [recommendation]);

  const accepted = recommendation.picks.filter((p) => decisions[p.name] !== 'reject').map((p) => p.name);
  const rejected = recommendation.picks.filter((p) => decisions[p.name] === 'reject').map((p) => p.name);
  const basics = Object.entries(recommendation.basic_lands);
  const basicCount = basics.reduce((sum, [, n]) => sum + n, 0);

  const toggle = (name: string) =>
    setDecisions((prev) => ({ ...prev, [name]: prev[name] === 'reject' ? 'accept' : 'reject' }));

  return (
    <section className="frame space-y-6">
      <div>
        <h3 className="section-title">Recommended Deck for {recommendation.commander}</h3>
        <p className="mt-3 text-lg text-mahogany-900">{recommendation.summary}</p>
        <p className="mt-2 text-mahogany-500">
          1 commander + {recommendation.picks.length} cards + {basicCount} basic lands ={' '}
          {1 + recommendation.picks.length + basicCount} · Click a card to reject it, or click again to restore it.
        </p>
      </div>

      {byRole.map(([role, picks]) => (
        <div key={role}>
          <h4 className="group-title mb-3">
            {ROLE_LABELS[role]} ({picks.length})
          </h4>
          <div className="grid gap-2 md:grid-cols-2">
            {picks.map((pick) => {
              const info = cardInfo[pick.name];
              const isRejected = decisions[pick.name] === 'reject';
              return (
                <button
                  key={pick.name}
                  {...bind(info?.image_url)}
                  onClick={() => toggle(pick.name)}
                  aria-pressed={isRejected}
                  className={`entry flex gap-3 p-2 text-left ${isRejected ? 'opacity-55' : ''}`}
                >
                  {info?.image_url_small && (
                    <img src={info.image_url_small} alt="" className="card-img card-pop w-12 shrink-0 self-start" loading="lazy" />
                  )}
                  <div>
                    <div className={`text-mahogany-900 ${isRejected ? 'line-through decoration-burgundy-600' : ''}`}>
                      {pick.name}
                      {isRejected && <span className="seal ml-2 no-underline">Rejected</span>}
                    </div>
                    <div className="text-sm text-mahogany-600">{pick.reason}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {basics.length > 0 && (
        <p className="text-mahogany-600">
          <span className="label inline">Basic lands</span> {basics.map(([name, n]) => `${n} ${name}`).join(', ')}
        </p>
      )}

      {recommendation.suggested_buys.length > 0 && (
        <div>
          <h4 className="group-title mb-3">Worth Buying (not in the deck)</h4>
          <ul className="space-y-1">
            {recommendation.suggested_buys.map((buy) => (
              <li key={buy.name} className="text-mahogany-700">
                {buy.scryfall_uri ? (
                  <a
                    className="text-burgundy-700 underline decoration-burgundy-600/40 underline-offset-2 hover:decoration-burgundy-600"
                    href={buy.scryfall_uri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {buy.name}
                  </a>
                ) : (
                  buy.name
                )}
                {buy.price_usd && <span className="text-mahogany-500"> (${buy.price_usd})</span>} — {buy.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 border-t border-mahogany-700/30 pt-5 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="revise-feedback">
            Feedback for the agent (optional)
          </label>
          <textarea
            id="revise-feedback"
            className="field w-full"
            rows={3}
            maxLength={1000}
            placeholder="e.g. more card draw, fewer expensive spells"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <button
            className="btn btn-secondary mt-3"
            disabled={busy || (rejected.length === 0 && !feedback.trim())}
            onClick={() => onRevise(accepted, rejected, feedback)}
          >
            Revise ({rejected.length} rejected)
          </button>
        </div>
        <div>
          <label className="label" htmlFor="deck-name">
            Deck name
          </label>
          <input id="deck-name" className="field w-full" maxLength={100} value={deckName} onChange={(e) => setDeckName(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || !deckName.trim()} onClick={() => onSave(deckName.trim(), accepted)}>
              Save Deck
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => onLoadIntoBuilder(accepted)}>
              Edit in Deck Builder
            </button>
            <button
              className="btn btn-secondary"
              title="Download a .txt file Moxfield can import (accepted cards only)"
              onClick={() =>
                downloadMoxfieldFile({
                  name: deckName,
                  commander: recommendation.commander,
                  cards: accepted,
                  basicLands: recommendation.basic_lands,
                })
              }
            >
              Export to Moxfield
            </button>
          </div>
        </div>
      </div>
      {preview}
    </section>
  );
}

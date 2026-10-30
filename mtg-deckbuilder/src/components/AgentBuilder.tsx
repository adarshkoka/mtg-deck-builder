// Step 3 ("Construct Deck"): ask the AI agent to build the deck, watch it work, then review it.
//
// 1. POST /decks/build -> run id (the agent runs in the background on the server)
// 2. poll GET /decks/runs/{id}: the trace grows step by step until the run finishes
// 3. the user accepts/rejects picks -> "Revise" starts a new run seeded with the feedback,
//    or "Save deck" stores the approved cards. Nothing is saved without the user.

import { useCallback, useEffect, useState } from 'react';
import { useCustomDeck } from '../contexts/CustomDeckContext';
import { useCardPreview } from '../hooks/useCardPreview';
import { usePolling } from '../hooks/usePolling';
import { api } from '../services/api';
import { buildWorkingDeck } from '../services/cardMapper';
import type { AgentRun, OwnedCard } from '../types/backend';
import { RecommendationReview } from './RecommendationReview';
import { TraceView } from './TraceView';

interface Props {
  collectionId: number;
  commander: OwnedCard;
  // The build being shown. It lives in App (not in this component) so it survives
  // switching tabs, which unmounts this component.
  runId: string | null;
  onRunChange: (runId: string | null) => void;
  onSaved: () => void;
  onOpenBuilder: () => void;
}

export function AgentBuilder({ collectionId, commander, runId, onRunChange: setRunId, onSaved, onOpenBuilder }: Props) {
  const { customDeck, replaceDeck } = useCustomDeck();
  const [notes, setNotes] = useState('');
  const [keepDeckCards, setKeepDeckCards] = useState(false);
  const [earlier, setEarlier] = useState<AgentRun[]>([]);
  const { bind, preview } = useCardPreview();
  const [startError, setStartError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardInfo, setCardInfo] = useState<Record<string, OwnedCard>>({});

  // Cards already in the working deck (same commander) can be sent as must-includes.
  const deckCards =
    customDeck.commander?.name === commander.name
      ? customDeck.cards.filter((c) => !c.isCommander && !c.card.supertypes?.includes('Basic')).map((c) => c.card.name)
      : [];

  const fetchRun = useCallback(() => api.getRun(runId!), [runId]);
  const { data: run, error: pollError } = usePolling<AgentRun>(
    runId ? fetchRun : null,
    (r) => r.status === 'succeeded' || r.status === 'failed',
    2000,
  );

  // Earlier builds for this commander, newest first, so any of them can be reopened.
  // Reloaded whenever the shown build changes or finishes.
  useEffect(() => {
    api
      .listRuns(collectionId)
      .then((runs) => setEarlier(runs.filter((r) => r.request.commander === commander.name)))
      .catch(() => setEarlier([]));
  }, [collectionId, commander.name, runId, run?.status]);

  // When a recommendation arrives, load images and text for its cards.
  useEffect(() => {
    if (!run?.result) return;
    api
      .lookupCards(collectionId, run.result.picks.map((p) => p.name))
      .then((cards) => setCardInfo(Object.fromEntries(cards.map((c) => [c.name, c]))))
      .catch(() => setCardInfo({}));
  }, [collectionId, run?.result]);

  const start = async () => {
    setStartError(null);
    setMessage(null);
    try {
      const { run_id } = await api.buildDeck({
        collection_id: collectionId,
        commander: commander.name,
        must_include: keepDeckCards ? deckCards.slice(0, 30) : [],
        notes: notes.trim() || null,
      });
      setRunId(run_id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  };

  const revise = async (accepted: string[], rejected: string[], feedback: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const { run_id } = await api.reviseRun(run.run_id, { accepted, rejected, feedback: feedback.trim() || null });
      setRunId(run_id);
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (name: string, accepted: string[]) => {
    if (!run?.result) return;
    setBusy(true);
    try {
      const keep = new Set(accepted);
      const saved = await api.saveDeck({
        collection_id: collectionId,
        name,
        commander: run.result.commander,
        cards: run.result.picks.filter((p) => keep.has(p.name)),
        basic_lands: run.result.basic_lands,
        source_run_id: run.run_id,
      });
      setMessage(saved.complete ? `Saved "${saved.name}" (100 cards).` : `Saved "${saved.name}" (${saved.card_count}/100 cards).`);
      onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const loadIntoBuilder = async (accepted: string[]) => {
    if (!run?.result) return;
    if (customDeck.cards.length > 0 && !confirm('Replace the deck currently in the deck builder?')) return;
    setBusy(true);
    try {
      replaceDeck(await buildWorkingDeck(collectionId, `${commander.name} (AI)`, commander, accepted, run.result.basic_lands));
      onOpenBuilder();
    } finally {
      setBusy(false);
    }
  };

  const running = run !== null && (run.status === 'queued' || run.status === 'running');

  return (
    <div className="space-y-8">
      <section className="frame flex flex-col gap-6 md:flex-row">
        {commander.image_url && (
          // Hovering pops the card, then shows a large readable copy (useCardPreview).
          <img
            src={commander.image_url}
            alt={commander.name}
            className="card-img card-pop w-44 shrink-0 cursor-zoom-in self-start"
            {...bind(commander.image_url)}
          />
        )}
        <div className="flex-1 space-y-4">
          <h2 className="section-title">Construct Deck: {commander.name}</h2>
          <div className="panel px-4 py-3">
            <p className="text-mahogany-500">{commander.type_line}</p>
            <p className="mt-1 whitespace-pre-wrap text-mahogany-900">{commander.oracle_text}</p>
          </div>
          <p className="text-mahogany-600">
            The agent searches your collection, checks the deck rules, and recommends a full 100-card deck with a reason
            for every card.
          </p>
          <div>
            <label className="label" htmlFor="deck-notes">
              Your wishes for the deck (optional)
            </label>
            <textarea
              id="deck-notes"
              className="field w-full"
              rows={2}
              maxLength={500}
              placeholder="e.g. go wide with tokens, avoid infinite combos"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {deckCards.length > 0 && (
            <label className="flex items-center gap-2 text-mahogany-600">
              <input type="checkbox" checked={keepDeckCards} onChange={(e) => setKeepDeckCards(e.target.checked)} />
              Keep the {Math.min(deckCards.length, 30)} cards already in my deck
            </label>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn-primary" disabled={running} onClick={() => void start()}>
              {running ? 'The agent is working…' : 'Build My Deck'}
            </button>
            {earlier.length > 0 && (
              <label className="flex items-center gap-2 text-mahogany-600">
                Earlier builds
                <select className="field" value={runId ?? ''} onChange={(e) => setRunId(e.target.value || null)}>
                  <option value="">(none selected)</option>
                  {earlier.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {new Date(r.created_at + 'Z').toLocaleString()} · {r.status}
                      {r.parent_run_id ? ' · revision' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {startError && <p className="notice notice-error">{startError}</p>}
          {pollError && <p className="notice notice-error">{pollError}</p>}
        </div>
      </section>

      {run && (
        <>
          {run.status === 'failed' && <p className="notice notice-error">The agent couldn't finish: {run.error}</p>}
          {running && <p className="notice animate-pulse">Status: {run.status}… (the trace below updates live)</p>}
          {run.result && run.status === 'succeeded' && (
            <RecommendationReview
              recommendation={run.result}
              cardInfo={cardInfo}
              busy={busy}
              onRevise={(a, r, f) => void revise(a, r, f)}
              onSave={(name, a) => void save(name, a)}
              onLoadIntoBuilder={(a) => void loadIntoBuilder(a)}
            />
          )}
          {message && <p className="notice">{message}</p>}
          <TraceView run={run} />
        </>
      )}
      {preview}
    </div>
  );
}

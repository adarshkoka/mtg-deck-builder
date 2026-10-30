// The app shell: pick a collection, pick a commander, then build the deck with AI or by
// hand. The working deck lives in CustomDeckContext (and localStorage); approved decks are
// saved on the server.

import { useState } from 'react';
import { AgentBuilder } from './components/AgentBuilder';
import { CardBrowser } from './components/CardBrowser';
import { CollectionPanel } from './components/CollectionPanel';
import { CommanderPicker } from './components/CommanderPicker';
import { CustomDeckView } from './components/CustomDeckView';
import { SavedDecks } from './components/SavedDecks';
import { SynergyWindow } from './components/SynergyWindow';
import { CustomDeckProvider, useCustomDeck } from './contexts/CustomDeckContext';
import { toScryfallCard } from './services/cardMapper';
import type { CollectionSummary, OwnedCard } from './types/backend';

type Tab = 'collection' | 'commander' | 'ai' | 'browse' | 'saved';

// The three main steps carry roman numerals; the other two tabs can be used at any time.
const TABS: { id: Tab; label: string; needs: 'nothing' | 'collection' | 'commander' }[] = [
  { id: 'collection', label: 'I. Collection', needs: 'nothing' },
  { id: 'commander', label: 'II. Commander', needs: 'collection' },
  { id: 'ai', label: 'III. Construct Deck', needs: 'commander' },
  { id: 'browse', label: 'Browse & Build by Hand', needs: 'collection' },
  { id: 'saved', label: 'Saved Decks', needs: 'collection' },
];

function Workspace() {
  const { customDeck, replaceDeck, getCardCount } = useCustomDeck();
  const [tab, setTab] = useState<Tab>('collection');
  const [collection, setCollection] = useState<CollectionSummary | null>(null);
  const [commander, setCommander] = useState<OwnedCard | null>(null);
  const [showDeck, setShowDeck] = useState(false);
  const [showSynergy, setShowSynergy] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0); // bump to refresh the saved-deck list
  // The AI build shown for each collection + commander. Kept here (not inside the
  // Construct Deck tab) so switching tabs doesn't lose it, and saved in the browser so a
  // page refresh doesn't either.
  const [runIds, setRunIds] = useState<Record<string, string>>(loadRunIds);
  const runKey = collection && commander ? `${collection.id}:${commander.name}` : null;
  const setRunId = (runId: string | null) => {
    if (!runKey) return;
    setRunIds((prev) => {
      const next = { ...prev };
      if (runId) next[runKey] = runId;
      else delete next[runKey];
      saveRunIds(next);
      return next;
    });
  };

  const chooseCollection = (next: CollectionSummary | null) => {
    setCollection(next);
    setCommander(null);
    if (next) setTab('commander');
  };

  const chooseCommander = (card: OwnedCard) => {
    // Picking a different commander starts a fresh working deck led by it. If a deck is in
    // progress, ask first; "Cancel" leaves everything as it was (same commander, same tab).
    if (customDeck.commander?.name !== card.name) {
      const inProgress = customDeck.cards.length > 0;
      if (inProgress && !confirm(`Start a new deck with ${card.name}? The current working deck will be replaced.`)) {
        return;
      }
      const leader = toScryfallCard(card);
      replaceDeck({
        name: `${card.name} deck`,
        commander: leader,
        cards: [{ card: leader, quantity: 1, isCommander: true }],
        colorIdentity: card.color_identity,
      });
    }
    setCommander(card);
    setTab('ai');
  };

  const enabled = (needs: (typeof TABS)[number]['needs']) =>
    needs === 'nothing' || (needs === 'collection' && collection !== null) || (needs === 'commander' && commander !== null);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Masthead: the title, what's selected, and the working deck. */}
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/favicon.svg" alt="" className="h-14 w-14 shrink-0" />
            <div>
              <h1 className="text-4xl tracking-wide text-burgundy-700 sm:text-5xl">MTG Commander Deckbuilder</h1>
              <p className="mt-1 text-lg text-mahogany-500">
                {collection ? `Collection: ${collection.name}` : 'Build Commander decks from the cards you own'}
                {commander && ` · Commander: ${commander.name}`}
              </p>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => setShowDeck(true)}>
            View Deck ({getCardCount()}/100)
          </button>
        </header>
        <div className="rule mb-6" />

        <nav className="mb-8 flex flex-wrap gap-2" aria-label="Steps">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              aria-current={tab === t.id ? 'page' : undefined}
              disabled={!enabled(t.needs)}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main>
          {tab === 'collection' && <CollectionPanel selected={collection} onSelect={chooseCollection} />}
          {tab === 'commander' && collection && (
            <CommanderPicker collectionId={collection.id} selected={commander} onSelect={chooseCommander} />
          )}
          {tab === 'ai' && collection && commander && (
            <AgentBuilder
              collectionId={collection.id}
              commander={commander}
              runId={runKey ? (runIds[runKey] ?? null) : null}
              onRunChange={setRunId}
              onSaved={() => setSavedVersion((v) => v + 1)}
              onOpenBuilder={() => setShowDeck(true)}
            />
          )}
          {tab === 'browse' && collection && (
            <CardBrowser collectionId={collection.id} commander={commander} onShowSynergy={() => setShowSynergy(true)} />
          )}
          {tab === 'saved' && collection && (
            <SavedDecks collectionId={collection.id} refreshKey={savedVersion} onOpenBuilder={() => setShowDeck(true)} />
          )}
        </main>
      </div>

      {showDeck && <CustomDeckView onClose={() => setShowDeck(false)} />}
      {showSynergy && collection && commander && (
        <SynergyWindow collectionId={collection.id} commander={commander} onClose={() => setShowSynergy(false)} />
      )}
    </div>
  );
}

const RUNS_KEY = 'mtg_build_runs';

function loadRunIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveRunIds(runIds: Record<string, string>): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runIds));
  } catch {
    // storage blocked: builds still work, they just won't survive a page refresh
  }
}

export default function App() {
  return (
    <CustomDeckProvider>
      <Workspace />
    </CustomDeckProvider>
  );
}

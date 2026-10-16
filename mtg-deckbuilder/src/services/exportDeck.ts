// Export a deck as a text file Moxfield can import.
//
// Moxfield imports the MTG Arena text format: a "Commander" section and a "Deck" section,
// one "<quantity> <card name>" per line, separated by a blank line. In Moxfield, use
// "Import" (or Bulk Edit) on a new deck and paste or upload the file.

export interface ExportableDeck {
  name: string;
  commander: string;
  cards: string[]; // non-basic cards, one copy each
  basicLands: Record<string, number>;
}

export function moxfieldText(deck: ExportableDeck): string {
  const main = [...deck.cards]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `1 ${name}`);
  const basics = Object.entries(deck.basicLands)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${count} ${name}`);
  return ['Commander', `1 ${deck.commander}`, '', 'Deck', ...main, ...basics, ''].join('\n');
}

export function downloadMoxfieldFile(deck: ExportableDeck): void {
  const blob = new Blob([moxfieldText(deck)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${deck.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'deck'}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

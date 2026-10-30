// Step 1: choose a collection, or upload a new one from a CSV export.
//
// Upload flow: POST the file -> the server answers at once with a job id -> poll the job
// until it succeeds or fails, showing a progress bar from batches_done / batches_total.

import { useCallback, useEffect, useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../services/api';
import type { CollectionSummary, EmbeddingStatus, ImportAccepted, ImportStatus } from '../types/backend';

interface Props {
  selected: CollectionSummary | null;
  onSelect: (collection: CollectionSummary | null) => void;
}

export function CollectionPanel({ selected, onSelect }: Props) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCollections(await api.listCollections());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async (collection: CollectionSummary) => {
    if (!confirm(`Delete "${collection.name}" and its saved decks?`)) return;
    await api.deleteCollection(collection.id);
    if (selected?.id === collection.id) onSelect(null);
    await refresh();
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="frame">
        <h2 className="section-title mb-5">Your Collections</h2>
        {loadError && <p className="notice notice-error mb-3">Can't reach the server: {loadError}</p>}
        {collections.length === 0 && !loadError && (
          <p className="text-mahogany-500">No collections yet. Upload a CSV to get started.</p>
        )}
        <ul className="space-y-2" role="listbox" aria-label="Collections">
          {collections.map((c) => (
            <li
              key={c.id}
              role="option"
              aria-selected={selected?.id === c.id}
              className="entry flex cursor-pointer items-center justify-between px-4 py-3"
              onClick={() => onSelect(c)}
            >
              <div>
                <div className="text-lg text-mahogany-900">{c.name}</div>
                <div className="text-sm text-mahogany-500">
                  {c.unique_cards} different cards · {c.total_cards} total · {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                className="btn btn-quiet btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(c);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        {selected && <SemanticSearchStatus collectionId={selected.id} />}
      </section>

      <UploadForm
        onImported={async (collectionId) => {
          await refresh();
          const fresh = (await api.listCollections()).find((c) => c.id === collectionId);
          if (fresh) onSelect(fresh);
        }}
      />
    </div>
  );
}

function UploadForm({ onImported }: { onImported: (collectionId: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('My collection');
  const [accepted, setAccepted] = useState<ImportAccepted | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Poll the import job only while we have one.
  const fetchStatus = useCallback(() => api.importStatus(accepted!.job_id), [accepted]);
  const { data: status, error: pollError } = usePolling<ImportStatus>(
    accepted ? fetchStatus : null,
    (s) => s.status === 'succeeded' || s.status === 'failed',
  );

  useEffect(() => {
    if (status?.status === 'succeeded') onImported(status.collection_id);
    // Only react to the status changing, not to a new onImported function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setAccepted(null);
    try {
      setAccepted(await api.importCollection(file, name));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const percent =
    status && status.batches_total > 0
      ? Math.round((status.batches_done / status.batches_total) * 100)
      : status?.status === 'succeeded'
        ? 100
        : 0;

  return (
    <section className="frame">
      <h2 className="section-title mb-2">Upload a Collection</h2>
      <p className="mb-5 text-mahogany-500">
        CSV exports from Moxfield, ManaBox, Archidekt, or any file with a Name column.
      </p>

      <label className="label" htmlFor="collection-name">
        Collection name
      </label>
      <input
        id="collection-name"
        className="field mb-4 w-full"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="label" htmlFor="collection-file">
        CSV file
      </label>
      <input
        id="collection-file"
        type="file"
        accept=".csv,text/csv"
        className="field mb-5 block w-full"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        className="btn btn-primary"
        disabled={!file || uploading || (status !== null && status.status === 'running')}
        onClick={() => void handleUpload()}
      >
        {uploading ? 'Uploading…' : 'Import'}
      </button>

      {uploadError && <p className="notice notice-error mt-4">{uploadError}</p>}
      {pollError && <p className="notice notice-error mt-4">{pollError}</p>}

      {accepted && (
        <div className="mt-5 space-y-3">
          <p className="text-mahogany-600">
            Detected format: <span className="text-mahogany-900">{accepted.source_format}</span> ·{' '}
            {accepted.rows_accepted} rows accepted
          </p>
          <div className="meter">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="text-mahogany-500">
            {status?.status === 'succeeded' && `Done: ${status.unique_cards} different cards imported.`}
            {status?.status === 'failed' && <span className="text-burgundy-700">Import failed: {status.error}</span>}
            {(status?.status === 'queued' || status?.status === 'running' || !status) &&
              `Matching cards with Scryfall… ${percent}%`}
          </p>
          <ProblemList
            title="Rows with errors (skipped)"
            items={accepted.row_errors.map((e) => `Line ${e.line}: ${e.message}`)}
          />
          <ProblemList
            title="Cards Scryfall couldn't find"
            items={(status?.not_found ?? []).map((n) => `Line ${n.line}: ${n.name}`)}
          />
        </div>
      )}
    </section>
  );
}

function ProblemList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="panel px-3 py-2">
      <summary className="cursor-pointer text-chestnut-600">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-mahogany-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

// Semantic ("search by meaning") needs every card embedded. New imports are embedded
// automatically; this shows the coverage and lets the user start it for older collections.
function SemanticSearchStatus({ collectionId }: { collectionId: number }) {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
    api.embeddingStatus(collectionId).then(setStatus).catch(() => setStatus(null));
  }, [collectionId]);

  if (!status) return null;
  const percent = Math.round(status.coverage * 100);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-mahogany-700/30 pt-4 text-mahogany-600">
      <span>
        Smart search coverage: <span className="text-mahogany-900">{percent}%</span>
      </span>
      {percent < 100 && (
        <button
          className="btn btn-secondary btn-sm"
          onClick={async () => {
            try {
              await api.startEmbedding(collectionId);
              setMessage('Started. This can take a few minutes for a large collection.');
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Enable
        </button>
      )}
      {message && <p className="w-full text-sm text-mahogany-500">{message}</p>}
    </div>
  );
}

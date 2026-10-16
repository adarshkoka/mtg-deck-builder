// Shows exactly what the AI agent did: every model call and every tool call, in order,
// with timing, token counts, and the inputs/outputs (click a row to expand it).

import { useState } from 'react';
import type { AgentRun, TraceStep } from '../types/backend';

export function TraceView({ run }: { run: AgentRun }) {
  const totalMs = run.trace.reduce((sum, s) => sum + s.duration_ms, 0);
  const tokens = run.trace.reduce((sum, s) => sum + s.input_tokens + s.output_tokens, 0);
  return (
    <section className="frame">
      <h3 className="section-title mb-2">The Agent's Work</h3>
      <p className="mb-4 text-sm text-mahogany-500">
        {run.engine} · {run.model} · {run.trace.filter((s) => s.kind === 'model').length} model calls ·{' '}
        {run.trace.filter((s) => s.kind === 'tool').length} tool calls · {tokens.toLocaleString()} tokens ·{' '}
        {(totalMs / 1000).toFixed(1)}s
      </p>
      {run.trace.length === 0 && <p className="text-mahogany-500">Waiting for the first step…</p>}
      <ol className="space-y-1">
        {run.trace.map((step) => (
          <StepRow key={step.step} step={step} />
        ))}
      </ol>
    </section>
  );
}

function StepRow({ step }: { step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const isModel = step.kind === 'model';
  const seal = isModel ? 'seal' : step.error ? 'seal seal-ink' : 'seal seal-chestnut';
  return (
    <li className="panel">
      <button className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="w-6 text-sm text-mahogany-400">{step.step}</span>
        <span className={`${seal} w-14 text-center`}>{isModel ? 'Model' : 'Tool'}</span>
        <span className="font-mono text-sm text-mahogany-900">{step.name}</span>
        <span className={`flex-1 truncate text-sm ${step.error ? 'text-burgundy-700' : 'text-mahogany-500'}`}>{summary(step)}</span>
        <span className="text-sm text-mahogany-400">{step.duration_ms} ms</span>
        {isModel && (
          <span className="text-sm text-mahogany-400">
            {step.input_tokens}→{step.output_tokens} tok
          </span>
        )}
      </button>
      {open && (
        <div className="grid gap-3 px-3 pb-3 md:grid-cols-2">
          <JsonBlock title="Input" value={step.input} />
          <JsonBlock title="Output" value={step.output} />
        </div>
      )}
    </li>
  );
}

// One line describing a step: which tools the model asked for, or the tool's arguments.
function summary(step: TraceStep): string {
  if (step.error) return step.error;
  if (step.kind === 'model') {
    const output = step.output as { text?: string; tool_calls?: { name: string }[] } | null;
    const calls = output?.tool_calls?.map((c) => c.name) ?? [];
    return calls.length ? `asked for: ${calls.join(', ')}` : output?.text?.slice(0, 120) ?? '';
  }
  return JSON.stringify(step.input).slice(0, 120);
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="label">{title}</div>
      <pre className="inset max-h-64 overflow-auto whitespace-pre-wrap break-words p-2 text-xs">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

"""OpenTelemetry tracing setup.

A "span" is a timed, named unit of work (one agent run, one model call, one tool call)
with attributes like token counts. Spans nest, so a trace shows the whole run as a tree.
The code creates spans with `tracer.start_as_current_span(...)`; this module decides
where they go:
- OTEL_EXPORTER=none (default): spans are created but dropped (almost no overhead)
- OTEL_EXPORTER=console: printed to the log, handy locally
- OTEL_EXPORTER=otlp: sent to a collector (Jaeger, Grafana Tempo, Honeycomb, ...) at
  OTEL_EXPORTER_OTLP_ENDPOINT
"""

import os
from functools import cache

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

tracer = trace.get_tracer("mtg_deck_builder")


@cache  # only configure once per process, however many times it's called
def setup_tracing() -> None:
    exporter_name = os.environ.get("OTEL_EXPORTER", "none").lower()
    if exporter_name == "none":
        return
    provider = TracerProvider(resource=Resource.create({"service.name": "mtg-deck-builder"}))
    if exporter_name == "console":
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    elif exporter_name == "otlp":
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        # The endpoint is read from OTEL_EXPORTER_OTLP_ENDPOINT by the exporter itself.
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

# Deploying to Google Cloud

The same container images that run locally in `docker compose` run in production. Only
the configuration changes: managed services replace the local Postgres and Redis
containers, and secrets come from Secret Manager instead of `.env`.

| Local (`docker compose`) | Google Cloud |
|---|---|
| `api` container | Cloud Run **service** (HTTP, scales with traffic) |
| `worker` container (Celery) | Cloud Run **worker pool** (always-on, pulls jobs from Redis; no HTTP) |
| `web` container (nginx) | Cloud Run service (or Cloud Storage + CDN for static files) |
| `db` (Postgres + pgvector) | **Cloud SQL for PostgreSQL** with the `vector` extension |
| `redis` | **Memorystore for Redis** (reachable only inside your VPC) |
| `server/.env` | **Secret Manager**, mounted as environment variables |

Why the worker isn't a normal Cloud Run service: services are built for HTTP requests and
may pause the CPU between requests, which would freeze a Celery worker waiting on Redis.
Worker pools are Cloud Run's resource for long-running pull-based workers.

## One-time setup

```sh
PROJECT=your-project-id
REGION=us-east4
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Container registry
gcloud artifacts repositories create mtg --repository-format=docker --location=$REGION

# Postgres (the smallest tier is fine to start; it has a monthly cost)
gcloud sql instances create mtg-db --database-version=POSTGRES_17 --region=$REGION \
  --tier=db-f1-micro --storage-size=10GB
gcloud sql databases create mtg --instance=mtg-db
gcloud sql users create mtg --instance=mtg-db --password="$(openssl rand -base64 24)"
# The app runs CREATE EXTENSION IF NOT EXISTS vector on startup (app/db.py).

# Redis (needs a VPC network; Cloud Run reaches it with Direct VPC egress)
gcloud redis instances create mtg-redis --size=1 --region=$REGION --network=default

# Secrets
printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
printf '%s' "$(python -c 'import secrets; print(secrets.token_urlsafe(32))')" | \
  gcloud secrets create api-key --data-file=-
printf '%s' "postgresql+asyncpg://mtg:PASSWORD@/mtg?host=/cloudsql/$PROJECT:$REGION:mtg-db" | \
  gcloud secrets create database-url --data-file=-
```

## Build and deploy

```sh
IMAGE=$REGION-docker.pkg.dev/$PROJECT/mtg
gcloud builds submit server --tag $IMAGE/server
REDIS_HOST=$(gcloud redis instances describe mtg-redis --region=$REGION --format='value(host)')

COMMON=(--region=$REGION --image=$IMAGE/server
  --add-cloudsql-instances=$PROJECT:$REGION:mtg-db
  --network=default --subnet=default --vpc-egress=private-ranges-only
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,API_KEY=api-key:latest,DATABASE_URL=database-url:latest
  --set-env-vars=GEMINI_MODEL=gemini-3.8-flash,REDIS_URL=redis://$REDIS_HOST:6379/0,TASK_RUNNER=celery)

# API: an HTTP service
gcloud run deploy mtg-api "${COMMON[@]}" --port=8080 --allow-unauthenticated \
  --set-env-vars=CORS_ORIGINS='["https://YOUR-WEB-URL"]'

# Worker: a worker pool running the Celery command instead of the web server
gcloud run worker-pools deploy mtg-worker "${COMMON[@]}" \
  --command=celery --args=-A,app.worker,worker,--loglevel=info,--concurrency=1 --instances=1

# Web: the frontend, built with the API's public URL
API_URL=$(gcloud run services describe mtg-api --region=$REGION --format='value(status.url)')
gcloud builds submit mtg-deckbuilder --tag $IMAGE/web  # pass VITE_API_URL=$API_URL as a build arg
gcloud run deploy mtg-web --image=$IMAGE/web --region=$REGION --port=80 --allow-unauthenticated
```

Check the current `gcloud run worker-pools deploy` flags with `--help` before running;
worker pools are newer than services and their flags may still change.

## Before real users

- **Authentication.** The API key is baked into the web app's JavaScript, so anyone who
  loads the page can read it: it stops casual abuse, not a determined user. For several
  users, add real sign-in (OAuth / Google Identity Platform) and keep keys server-side.
- **Migrations.** `create_all` only creates missing tables. Add Alembic before changing an
  existing table's columns in production.
- **One worker.** The Scryfall and Gemini rate limiters live in process memory, so the
  worker pool runs one instance. Scaling out needs a shared limiter (e.g. in Redis).
- **Tracing.** Set `OTEL_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT` to send the
  agent's spans to Cloud Trace (via an OpenTelemetry collector) or any OTLP backend.

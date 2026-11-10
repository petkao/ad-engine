#!/bin/bash
# Deploy ad-engine-api to Cloud Run
# Uses --clear-base-image to force Dockerfile build (prevents Buildpacks issues)

set -e

# Production lives in ad-engine-4da45; pin it so the gcloud default project can't redirect the deploy
PROJECT_ID="ad-engine-4da45"

# Always deploy this folder, even when the script is run from elsewhere
cd "$(dirname "$0")"

echo "Deploying ad-engine-api to Cloud Run (project: $PROJECT_ID)..."

gcloud run deploy ad-engine-api \
  --project "$PROJECT_ID" \
  --source . \
  --region us-west1 \
  --platform managed \
  --clear-base-image \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300

echo "Deployment complete!"
echo "Service URL: https://ad-engine-api-610270819686.us-west1.run.app"

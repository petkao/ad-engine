#!/bin/bash
# Deploy ad-engine-api to Cloud Run
# Uses --clear-base-image to force Dockerfile build (prevents Buildpacks issues)

set -e

echo "Deploying ad-engine-api to Cloud Run..."

gcloud run deploy ad-engine-api \
  --source . \
  --region us-west1 \
  --platform managed \
  --clear-base-image \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300

echo "Deployment complete!"
echo "Service URL: https://ad-engine-api-610270819686.us-west1.run.app"

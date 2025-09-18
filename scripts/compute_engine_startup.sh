#!/bin/bash

# Compute Engine startup script for Google Ngram processing
# Repo-driven workflow: Cloud Build uploads scripts to GCS, VM downloads and runs them

set -euo pipefail

echo "Starting Compute Engine ngram processing setup..."

# Update system
apt-get update

# Install Python, pip, curl, jq (for metadata and token handling)
apt-get install -y python3 python3-pip curl jq

# Working directory
mkdir -p /opt/ngram-processor
cd /opt/ngram-processor

# Helper to read instance metadata
md() {
  curl -fsSL -H "Metadata-Flavor: Google" "http://metadata/computeMetadata/v1/$1" || true
}

# Read metadata-provided settings
FIREBASE_STORAGE_BUCKET=$(md instance/attributes/firebase-storage-bucket)
# Strip leading gs:// if present
FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET#gs://}
SCRIPTS_BUCKET=$(md instance/attributes/startup-scripts-bucket)
SCRIPTS_PREFIX=$(md instance/attributes/startup-scripts-prefix)

# Fallbacks
SCRIPTS_BUCKET=${SCRIPTS_BUCKET:-$FIREBASE_STORAGE_BUCKET}
SCRIPTS_PREFIX=${SCRIPTS_PREFIX:-compute-startup}

echo "Using scripts bucket: ${SCRIPTS_BUCKET} (prefix: ${SCRIPTS_PREFIX})"

# Export bucket for Python script
export FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}

# Obtain an access token for authenticated GCS downloads
ACCESS_TOKEN=$(md instance/service-accounts/default/token | jq -r .access_token)

# Function to download from GCS via JSON API
gcs_download() {
  local bucket="$1"; shift
  local object="$1"; shift
  local out_path="$1"; shift
  curl -fsSL -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://storage.googleapis.com/storage/v1/b/${bucket}/o/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=""))' "${object}")?alt=media" \
    -o "${out_path}"
}

# Download requirements and processor from GCS (uploaded by Cloud Build)
gcs_download "${SCRIPTS_BUCKET}" "${SCRIPTS_PREFIX}/requirements.txt" \
  /opt/ngram-processor/requirements.txt || true
gcs_download "${SCRIPTS_BUCKET}" "${SCRIPTS_PREFIX}/ngram_processor.py" \
  /opt/ngram-processor/ngram_processor.py

# Install Python dependencies if present
if [ -f /opt/ngram-processor/requirements.txt ]; then
  pip3 install -r /opt/ngram-processor/requirements.txt
else
  # Fallback minimal deps
  pip3 install google-cloud-storage google-cloud-firestore requests
fi

chmod +x /opt/ngram-processor/ngram_processor.py

# Run the processor
echo "Starting ngram processing..."
python3 /opt/ngram-processor/ngram_processor.py

echo "Ngram processing completed. Shutting down instance..."
# Shutdown the instance when done
shutdown -h now

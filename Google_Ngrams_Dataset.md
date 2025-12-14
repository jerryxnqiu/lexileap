# Google Books Ngram Dataset Preparation

## Overview
The system processes Google Books Ngram Viewer datasets (1-5 grams) on a Compute Engine VM and stores curated results in Firebase Storage. This provides a frequency-ranked vocabulary pool for the LexiLeap application.

## Data Source
- **Public Google Cloud Storage bucket**: `http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-{n}gram-20120701-`
- **Shard structure**:
  - **1-gram**: 26 shards (a-z, single letter prefixes)
  - **2-5 gram**: 676 shards each (aa-zz, two-letter prefixes)
  - **Total**: 26 + (676 × 4) = **2,730 shards** across all n-gram types
- **Data format**: TSV files (gzip compressed)
  - Format: `ngram<TAB>year<TAB>match_count<TAB>volume_count`

## Processing Logic

### Configuration
```python
FREQUENCY_THRESHOLD = 5000  # Minimum occurrences to keep
TOP_COUNTS = {
    '1gram': 30000,   # Top 30,000 words
    '2gram': 10000,   # Top 10,000 2-word phrases
    '3gram': 10000,   # Top 10,000 3-word phrases
    '4gram': 10000,   # Top 10,000 4-word phrases
    '5gram': 10000    # Top 10,000 5-word phrases
}
```

### Processing Steps (per n-gram type)

1. **Download & Parse Shards**
   - Downloads each `.gz` shard file from Google Cloud Storage
   - Streams and decompresses gzip files
   - Parses TSV format to extract:
     - `ngram`: The word or phrase
     - `match_count`: Frequency/occurrence count (aggregated across years)

2. **Filtering**
   - **Alphabetic only**: Only keeps grams where all tokens contain only alphabetic characters (`is_alpha()`)
   - **Token validation**: Ensures correct number of tokens matches n-gram type (1-5)
   - **Frequency aggregation**: Sums match counts across all years for each unique gram

3. **Frequency Threshold**
   - **Minimum frequency**: 5,000 occurrences
   - Only grams meeting this threshold are retained
   - Filters out rare/obscure terms

4. **Per-Shard Output**
   - Saves filtered results for each shard to Firebase Storage
   - **Path**: `google-ngram/{n}gram_{shard_id}_filtered.json`
   - Enables incremental processing and recovery
   - **Note**: Aggregation is done separately to avoid missing history from restarting VM due to OOM issues on the VM

5. **Aggregation & Ranking** (Separate Step)
   - Performed via Cloud Run API endpoint: `POST /api/google-ngram/aggregate`
   - Loads all filtered shard files for each n-gram type from Firebase Storage
   - Merges and aggregates frequencies across all shards
   - Ranks by frequency (descending order)
   - Takes top N results per type:
     - **1-gram**: Top 30,000 words
     - **2-5 gram**: Top 10,000 phrases each
   - Generates final output files (see below)

6. **Final Outputs**
   - **Per-type top files**: `google-ngram/{n}gram_top.json`
   - **Consolidated files**:
     - `google-ngram/words_top.json` (1-gram results)
     - `google-ngram/phrases_top.json` (2-5 gram combined, ~40,000 phrases)

## Checkpointing & Resumability

- **Firestore tracking**: Uses `ngram_shards` collection to track processed shards
  - Document ID: `{ngram_type}_{shard_id}`
  - Fields: `status`, `url`, `updatedAt`
- **Resume capability**: Skips already-processed shards on reruns
- **Progress tracking**: Updates status after each shard completes
- **System job status**: Updates `system_jobs/google_ngram_last_run` on completion

## Execution Flow

1. **Trigger**
   - API endpoint: `/api/google-ngram/generate` or `/api/google-ngram/trigger-compute`
   - Creates a Compute Engine VM instance

2. **VM Creation**
   - **Instance type**: `e2-highmem-2` (high memory for large data processing)
   - **Disk**: 50GB, auto-delete on shutdown
   - **Service account**: Configured with Cloud Platform scope
   - **Metadata**: Includes Firebase Storage bucket, Firestore database, and script locations

3. **Startup Script** (`compute_engine_startup.sh`)
   - Installs Python 3, pip, and dependencies
   - Downloads processing scripts from GCS (uploaded by Cloud Build)
   - Sets environment variables from VM metadata
   - Runs `ngram_processor.py`

4. **Processing**
   - Processes all shards sequentially
   - Uploads results to Firebase Storage
   - Updates Firestore checkpoints
   - Logs progress every 50,000 lines

5. **Shutdown**
   - VM automatically shuts down when processing completes
   - Instance is auto-deleted (ephemeral)

6. **Aggregation** (Post-Processing)
   - After shard processing completes, call the aggregation endpoint
   - **Endpoint**: `POST /api/google-ngram/aggregate`
   - **Body**: `{ "ngramType": "1gram" }` (optional, omit to process all types)
   - This step runs in Cloud Run with more memory, avoiding OOM issues
   - Generates the final top files and consolidated outputs

## Scripts & Files

- **Main processor**: `scripts/ngram_processor.py`
- **Startup script**: `scripts/compute_engine_startup.sh`
- **Requirements**: `scripts/requirements.txt`
- **Cloud Build**: Uploads scripts to GCS bucket `{project-id}-compute-engine-startup`

## Output Structure

```
Firebase Storage:
├── google-ngram/
│   ├── 1gram_a_filtered.json
│   ├── 1gram_b_filtered.json
│   ├── ... (per-shard filtered results)
│   ├── 1gram_top.json (top 30,000 words)
│   ├── 2gram_top.json (top 10,000 phrases)
│   ├── 3gram_top.json (top 10,000 phrases)
│   ├── 4gram_top.json (top 10,000 phrases)
│   ├── 5gram_top.json (top 10,000 phrases)
│   ├── words_top.json (consolidated 1-gram)
│   └── phrases_top.json (consolidated 2-5 gram)
```

## Usage in Application

The processed n-gram data is used as a vocabulary pool for:
- Word selection in quiz generation
- Frequency-based word ranking
- Phrase analysis and context understanding

## Notes

- Processing time: Several hours for all 2,730 shards
- Network: Requires stable connection to download from Google Cloud Storage
- Cost: Compute Engine charges apply during processing (instance auto-shuts down when done)
- Resumability: Can restart processing; already-processed shards are skipped

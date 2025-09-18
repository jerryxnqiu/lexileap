#!/usr/bin/env python3
"""
Google Ngram Data Processor for Compute Engine
Processes Google Ngram data and uploads results to Firebase Storage
"""

import os
import json
import gzip
import requests
import time
from typing import Dict, List, Tuple
from collections import defaultdict
import re
from google.cloud import storage, firestore
from google.auth import default
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
FREQUENCY_THRESHOLD = 5000
TOP_COUNTS = {
    '1gram': 30000,
    '2gram': 10000,
    '3gram': 10000,
    '4gram': 10000,
    '5gram': 10000
}

def is_alpha(word: str) -> bool:
    """Check if word contains only alphabetic characters"""
    return bool(re.match(r'^[a-zA-Z]+$', word))

def is_clean_gram(tokens: List[str]) -> bool:
    """Check if all tokens in gram are alphabetic"""
    return len(tokens) > 0 and all(is_alpha(token) for token in tokens)

def build_shard_urls(n: int) -> List[str]:
    """Build URLs for n-gram shards"""
    base = f"http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-{n}gram-20120701-"
    letters = 'abcdefghijklmnopqrstuvwxyz'
    urls = []
    
    if n == 1:
        # 1-gram: single letter shards (a-z)
        for letter in letters:
            urls.append(f"{base}{letter}.gz")
    else:
        # 2-5 gram: two-letter shards (aa-zz)
        for i in letters:
            for j in letters:
                shard = f"{i}{j}"
                urls.append(f"{base}{shard}.gz")
    
    return urls

def process_shard(url: str, n: int) -> Dict[str, int]:
    """Process a single n-gram shard and return aggregated results"""
    logger.info(f"Processing {url}")
    agg = defaultdict(int)
    line_count = 0
    
    try:
        response = requests.get(url, stream=True, timeout=300)
        response.raise_for_status()
        
        # Handle gzip decompression
        if url.endswith('.gz'):
            stream = gzip.GzipFile(fileobj=response.raw)
        else:
            stream = response.raw
        
        for line in stream:
            line = line.decode('utf-8').strip()
            if not line:
                continue
                
            line_count += 1
            if line_count % 50000 == 0:
                logger.info(f"Processed {line_count} lines from {url}")
            
            # Parse TSV: ngram<TAB>year<TAB>match_count<TAB>volume_count
            parts = line.split('\t')
            if len(parts) >= 3:
                gram = parts[0]
                try:
                    match = int(parts[2])
                except ValueError:
                    continue
                
                tokens = gram.split(' ')
                if len(tokens) != n or not is_clean_gram(tokens):
                    continue
                
                agg[gram] += match
        
        logger.info(f"Completed {url}: {line_count} lines, {len(agg)} unique grams")
        return dict(agg)
        
    except Exception as e:
        logger.error(f"Error processing {url}: {e}")
        return {}

def filter_and_rank(grams: Dict[str, int], n: int, top_n: int) -> List[Dict[str, int]]:
    """Filter and rank grams, returning top N results"""
    # Filter by frequency threshold
    filtered = {gram: freq for gram, freq in grams.items() if freq >= FREQUENCY_THRESHOLD}
    
    # Sort by frequency (descending) and take top N
    sorted_grams = sorted(filtered.items(), key=lambda x: x[1], reverse=True)
    top_grams = [{"gram": gram, "freq": freq} for gram, freq in sorted_grams[:top_n]]
    
    return top_grams

def upload_to_storage(bucket_name: str, file_path: str, data: any) -> None:
    """Upload data to Firebase Storage"""
    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(file_path)
        
        if isinstance(data, (dict, list)):
            blob.upload_from_string(json.dumps(data), content_type='application/json')
        else:
            blob.upload_from_string(data)
            
        logger.info(f"Uploaded {file_path} to storage")
    except Exception as e:
        logger.error(f"Error uploading {file_path}: {e}")

def update_firestore_checkpoint(ngram_type: str, shard_id: str, url: str) -> None:
    """Update Firestore checkpoint"""
    try:
        db = firestore.Client()
        doc_ref = db.collection('ngram_shards').document(f"{ngram_type}_{shard_id}")
        doc_ref.set({
            'status': 'done',
            'url': url,
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        logger.info(f"Updated checkpoint for {ngram_type}_{shard_id}")
    except Exception as e:
        logger.error(f"Error updating checkpoint: {e}")

def is_shard_done(ngram_type: str, shard_id: str, db_client: firestore.Client | None) -> bool:
    """Check if shard is already processed using provided Firestore client (supports non-default DB)."""
    try:
        client = db_client or firestore.Client()
        doc_ref = client.collection('ngram_shards').document(f"{ngram_type}_{shard_id}")
        doc = doc_ref.get()
        return doc.exists and doc.get('status') == 'done'
    except Exception as e:
        logger.error(f"Error checking checkpoint: {e}")
        return False

def main():
    """Main processing function"""
    logger.info("Starting Google Ngram processing on Compute Engine")
    
    # Get configuration from environment (required)
    bucket_name = os.environ.get('FIREBASE_STORAGE_BUCKET')
    if not bucket_name:
        logger.error('FIREBASE_STORAGE_BUCKET not set. Ensure VM metadata includes firebase-storage-bucket and startup script exports it.')
        return
    out_prefix = 'data/google-ngram'
    
    # Initialize Firestore (support non-default database name via FIRESTORE_DB)
    firestore_db = os.environ.get('FIRESTORE_DB')
    try:
        db_client = firestore.Client(database=firestore_db) if firestore_db else firestore.Client()
    except Exception as e:
        logger.error(f"Failed to initialize Firestore client: {e}")
        db_client = None

    # Hold consolidated outputs
    words_top: List[Dict[str, int]] = []
    phrases_top_accum: List[Dict[str, int]] = []

    # Process each n-gram type
    for n in range(1, 6):
        ngram_type = f"{n}gram"
        logger.info(f"Processing {ngram_type}")
        
        urls = build_shard_urls(n)
        type_aggregate = defaultdict(int)
        processed_count = 0
        skipped_count = 0
        
        for url in urls:
            shard_id = url.split('/')[-1].replace('.gz', '')
            
            # Check if already processed
            if is_shard_done(ngram_type, shard_id, db_client):
                logger.info(f"Skipping {ngram_type}/{shard_id} - already processed")
                skipped_count += 1
                continue
            
            # Process shard
            shard_results = process_shard(url, n)
            
            # Save filtered results for this shard
            filtered_shard = {gram: freq for gram, freq in shard_results.items() 
                            if freq >= FREQUENCY_THRESHOLD}
            shard_file = f"{out_prefix}/{ngram_type}_{shard_id}_filtered.json"
            upload_to_storage(bucket_name, shard_file, filtered_shard)
            
            # Merge into type aggregate
            for gram, freq in shard_results.items():
                type_aggregate[gram] += freq
            
            # Update checkpoint (if Firestore available)
            try:
                if db_client:
                    # Use the initialized client rather than implicit default
                    doc_ref = db_client.collection('ngram_shards').document(f"{ngram_type}_{shard_id}")
                    doc_ref.set({
                        'status': 'done',
                        'url': url,
                        'updatedAt': firestore.SERVER_TIMESTAMP
                    })
                else:
                    update_firestore_checkpoint(ngram_type, shard_id, url)
            except Exception as e:
                logger.error(f"Error updating checkpoint with explicit client: {e}")
            processed_count += 1
            
            # Small delay to avoid overwhelming the system
            time.sleep(1)
        
        # Generate final top results for this type
        logger.info(f"Generating final results for {ngram_type}")
        top_results = filter_and_rank(dict(type_aggregate), n, TOP_COUNTS[ngram_type])
        top_file = f"{out_prefix}/{ngram_type}_top.json"
        upload_to_storage(bucket_name, top_file, top_results)

        # Build consolidated outputs: words (1gram) and phrases (2-5gram)
        if n == 1:
            words_top = top_results
        else:
            phrases_top_accum.extend(top_results)
        
        logger.info(f"Completed {ngram_type}: processed {processed_count}, skipped {skipped_count}, "
                   f"final top {len(top_results)} grams")
    
    # Update system job status
    try:
        db = firestore.Client()
        db.collection('system_jobs').document('google_ngram_last_run').set({
            'ranAt': firestore.SERVER_TIMESTAMP,
            'completed': True
        })
        logger.info("Updated system job status")
    except Exception as e:
        logger.error(f"Error updating system job status: {e}")
    
    # Write consolidated outputs
    try:
        if words_top:
            upload_to_storage(bucket_name, f"{out_prefix}/words_top.json", words_top)
        if phrases_top_accum:
            # Optionally limit combined phrases size; keep as-is for now
            upload_to_storage(bucket_name, f"{out_prefix}/phrases_top.json", phrases_top_accum)
        logger.info("Wrote consolidated words_top.json and phrases_top.json")
    except Exception as e:
        logger.error(f"Error writing consolidated outputs: {e}")

    logger.info("Google Ngram processing completed successfully")

if __name__ == "__main__":
    main()

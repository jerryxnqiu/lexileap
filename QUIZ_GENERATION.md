## Quiz Generation (Streaming) - Design and Behavior

### Overview
- The quiz is generated via Server-Sent Events (SSE) to provide live progress and a guaranteed 50-question session.
- Primary endpoint (data-processing instance): `/api/quiz/generate-stream`.
- Main instance proxy (same-origin for the client): `GET /api/quiz/generate?userId=...`.
- Client connects with `EventSource('/api/quiz/generate?userId=...')` and listens for events.

### Data Sources
- Big vocabulary pool from Cloud Storage: `data/wordnet.json` (WordNet-derived content).
- Question bank: Firestore collection `quiz_questions` (persisted, AI-generated options cached over time).
- User history and analytics:
  - `user_quiz_attempts` (per-attempt answers with correctness)
  - `word_analytics` (aggregate correctness and difficulty per word)

### Generation Strategy
1) New-first phase (target: 30 new words):
   - Sample from big JSON (`getRandomWords`) and generate questions.
   - For each word, call DeepSeek to get 3 misleading options using the correct definition.
   - Save newly generated questions to `quiz_questions` (question bank grows over time).

2) Bank top-up phase (remaining 10–20 words):
   - Prioritize the user’s weak words:
     - Aggregate from `user_quiz_attempts`: wrong-rate (wrong/total), then most recent failure.
     - Pick bank questions matching these words first.
   - Fill any remaining from the bank pool (without duplication).

### Deduplication
- Scope: within a single session (50 questions).
- Mechanism: `usedWords` set seeded from already-picked words; candidates with the same word are skipped.
- Granularity: dedup by `word` string (not by sense).

### Events (SSE)
- `start`: `{ message, target }` – generation started.
- `bank`: `{ used }` – legacy (bank-first); may be ignored in new-first flow.
- `batch`: `{ batch, fetched, remaining }` – a new candidate batch from big JSON.
- `word`: `{ word, count }` – a word was successfully generated and added.
- `error`: `{ word, message }` – DeepSeek failure for a specific word (non-fatal).
- `admin-bank-topup` (admin-only): `{ added, total, adminOnly: true }` – bank fallback usage.
- `complete`: `{ session }` – final 50-question session object (saved to `quiz_sessions`).

### Failure Handling
- No hard 500 failures in streaming flow.
- If several consecutive batches make no progress (e.g., network/AI instability), perform a bank top-up to reach 50 and complete.

### Security & Secrets
- DeepSeek API key: Secret Manager `lexileap-deepseek-api-key` (server-side only).
- Inter-service auth (main → data-processing): Google ID token; main exposes an SSE proxy to avoid CORS and keep secrets server-side.

### Cost & Performance Controls
- DeepSeek calls are sequential (per-word) to minimize tokens and keep control over spend.
- Compact prompt; moderate temperature; low `max_tokens`.
- Overfetch candidate words (≈3× remaining) to mitigate AI/network variance.
- As the bank grows, fewer DeepSeek calls are required over time.

### Session Persistence
- On completion, a `quiz_sessions` document is created with full session data (50 questions, answers initialized as null, timestamps).
- Generated or reused bank questions update usage stats (`timesTested`, `lastUsed`).

### Client Integration Summary
- Start: `new EventSource('/api/quiz/generate?userId=...')`.
- Update UI on `start`, `batch`, `word` (e.g., progress bar “Prepared X/50”).
- Ignore `admin-bank-topup` in client UI (internal telemetry).
- On `complete`, load the session into the quiz UI.



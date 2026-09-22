# Capture and workflow validation — 2026-09-22

This change improves material import, source subscriptions, reading, persistent chat sessions, retrieval policy, capture reliability, and transactional storage.

## User-visible behavior

- One-time saving and continuous subscription are separate actions.
- Background updates preserve unsaved forms; source changes become unread independently of AI processing.
- Original and organized documents have separate views. Chat references open their source material, and conversation history survives reloads and desktop port changes.
- Narrow screens support message submission without navigation or floating-button overlap.

## Capture and data integrity

- Structured API list entries feed refresh jobs directly. Partial captures preserve historical comments and carry explicit coverage metadata.
- Teams groups use complete conversation IDs instead of ambiguous title matches. Stable message IDs, nested author/time containers, image placeholders, system messages, edits, and legacy IDs are handled explicitly.
- Teams virtual scrolling targets the message viewport, preserves overlapping ranges, honors cancellation, and reports its stopping reason. Identical repeated captures do not create false updates.
- Keyword and vector retrieval share eligibility filters. All model requests enforce material policy; embeddings reuse unchanged document chunks.
- Item writes use transactions and recovery. Backup imports validate staged content before replacing the library. Local API mutations enforce origin and content-type checks, with explicit pairing for capture scripts.

## Verification

- `npm run check`: passed.
- `npm test`: 90 tests passed, no failures or skipped tests.
- `git diff --check`: passed.
- Browser checks covered desktop and narrow-screen reading, persistent conversations, message submission, and source-reference navigation.
- An authenticated Teams group was tested using the production DOM extraction and scrolling functions: initial DOM counts matched extracted IDs; a bounded capture saved 82 unique messages; repeated saving reported no change. An incremental capture observed 36 messages and preserved all 82 previously stored records.
- Real content was used only in an isolated local test library, subsequently deleted. No messages were sent and no production library was modified.

## Boundaries

Virtualized Teams capture is explicitly partial, not an assertion that all historical messages were retrieved. Images retain available descriptions/placeholders without OCR. The authenticated browser test does not cover the desktop application's separate first-login flow, Graph API, or team channels. Full provider pagination and cross-process file locking remain outside this change.

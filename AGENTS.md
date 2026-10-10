Make sure to run all tests and make sure they past after every change.

- Thread list rows have one source of truth: `src/frontend/thread_list_state.ts` (server snapshot + pending removals). Route any action that removes rows through `withRemoval` in `clientmain.ts`, and refresh the list after other mutations (e.g. bundle create/edit/ungroup, which the server doesn't broadcast) instead of patching the thread list island's rows locally. Local patches race with websocket-triggered refetches and get overwritten or bring removed rows back.

- Thread files in `data/threads` must only be written or removed through `thread_repository.ts` (`saveThreadJson`, `deleteThread`, `evictThread`). The repository keeps an in-memory, write-through summary index (`listThreadSummaries`) that backs the thread list, so other writers leave the list stale until the server restarts. Files edited by hand or restored from a backup aren't picked up until a restart either.

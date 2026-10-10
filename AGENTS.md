Make sure to run all tests and make sure they past after every change.

- Thread list rows have one source of truth: `src/frontend/thread_list_state.ts` (server snapshot + pending removals). Route any action that removes rows through `withRemoval` in `clientmain.ts`, and refresh the list after other mutations (e.g. bundle create/edit/ungroup, which the server doesn't broadcast) instead of patching the thread list island's rows locally. Local patches race with websocket-triggered refetches and get overwritten or bring removed rows back.

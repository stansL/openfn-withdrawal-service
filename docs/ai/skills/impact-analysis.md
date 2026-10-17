# Prompt: Impact analysis

Follow [the change protocol](../CHANGE_PROTOCOL.md). Before editing, inspect and report:

- current execution path and state owner;
- direct and transitive callers;
- public/API/data contracts affected;
- concurrency, idempotency, security and failure invariants at risk;
- tests that currently protect those areas and any evidence gaps;
- smallest safe change surface and intended verification.

Read-only commands to inspect files, search callers and inspect Git state are permitted. Do not edit files or mutate application state in this phase. State the analysis in the response before implementation.

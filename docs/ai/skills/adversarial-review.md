# Prompt: Adversarial review

Follow [the change protocol](../CHANGE_PROTOCOL.md). Label the review as self-review or independent review; independent review requires a reviewer/context that did not author the change.

Review the final diff skeptically for hidden domain assumptions, incorrect state ownership, race conditions, retry amplification, security/privacy leaks, persistence/API drift, operational regressions and unjustified infrastructure. Cite files/tests, severity, consequences and evidence gaps. Enumerate all nine [AGENTS.md](../../../AGENTS.md) invariants with pass/fail notes; a failure includes an unresolved evidence gap for an affected invariant.

Report findings without editing. The implementer handles findings under the protocol's scope, verification and approval rules. Do not claim independence merely because a second prompt was used in the author's context.

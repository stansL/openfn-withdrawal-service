# AI usage

I used ChatGPT as an engineering accelerator during the exercise, but not as an authority for correctness.

The ongoing workflow is defined in [CHANGE_PROTOCOL.md](docs/ai/CHANGE_PROTOCOL.md): explore, plan, implement narrowly, test the changed area and callers, run full verification, review, stage and stop for human acceptance. Use [CHANGE_TEMPLATE.md](docs/ai/CHANGE_TEMPLATE.md) for each new task.

Review evidence must distinguish self-review from independent review. Documentation-only changes can receive self-review unless they alter domain policy or remove safety requirements, which require independent review; changes to financial correctness, persistence, access control or concurrency require a reviewer who did not author the change, as specified in the protocol.

Concrete examples of AI-assisted review that changed this solution:

- challenged the initial assumption that “authorised” meant immediately debiting the account; the implementation was changed to a **time-bound reservation** model;
- identified the need to revalidate account access at the state-mutation boundary to close a TOCTOU window;
- identified that tests should exercise the production SQLite adapter in addition to the injected fast test adapter;
- challenged automatic startup seeding of known bearer tokens; seed fixtures are now explicit;
- identified account-enumeration risk from distinguishing inaccessible and nonexistent account IDs;
- expanded concurrency/idempotency/rollback tests and FX failure analysis;
- challenged rate caching/provider fallback as business-policy decisions rather than generic resilience features.

The reusable instruction templates used for this workflow are in `docs/ai/skills/`. They are lightweight project skills/prompts, not a claim that an autonomous agent is trusted to merge or deploy code.

[AGENTS.md](AGENTS.md) supplies repository-level agent instructions and domain invariants. These instructions guide behavior; they do not enforce permissions. The existing CI workflow runs verification, while required checks, human approvals and protected branches must be configured in the hosting service. No hosted protection is implied by this document.

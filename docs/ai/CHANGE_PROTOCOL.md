# Safe AI-assisted change protocol

This is the authoritative change procedure. [AGENTS.md](../../AGENTS.md) owns the non-negotiable domain invariants. Supporting prompts and historical records refer here rather than defining competing approval rules.

## 1. Explore (read-only)

Read the repository instructions, README, decisions, historical implementation plan and relevant implementation/tests. Use [impact analysis](skills/impact-analysis.md). Read-only file searches, caller tracing and Git inspection are permitted; do not edit files or mutate application state during exploration.

Identify the execution path, state owner, direct/transitive callers, contracts, failure boundaries and relevant test evidence. Establish the existing changes with `git status` and preserve unrelated work.

If Git metadata is absent, report it and save originals of intended files outside the project before editing. Review against those originals; do not initialize Git or invent history. Implementation and verification may proceed, but staging and Git-based review remain unavailable.

## 2. Plan and authorization

State a short task-specific plan before editing using [the template](CHANGE_TEMPLATE.md): outcome, files, affected invariants/contracts, tests, risks and exclusions. Scale the explanation to the change; documentation-only changes can use a short paragraph.

A clear engineer request authorizes narrow implementation within its scope without a separate plan-approval round. Stop and request a decision before a material scope expansion, an invariant conflict or a change that cannot be implemented narrowly. Present the affected invariants and alternatives. Do not silently relax an invariant.

The original [PLAN.md](PLAN.md) is historical context, not the active task plan.

## 3. Implement narrowly

Preserve unrelated behavior, interfaces and existing edits. Avoid opportunistic refactors. For every changed invariant or behavior, add/update meaningful regression tests that fail without the change. Documentation-only changes require documentation checks, not artificial runtime tests. Update decisions and the invariant map when their content changes.

## 4. Targeted verification

Run relevant changed-area tests plus affected direct caller, route/contract and persistence tests. Consult [the invariant map](INVARIANT_TEST_MAP.md); distinguish executable evidence from code inspection and coverage gaps. Check documentation links and referenced commands/test names for documentation changes.

## 5. Full verification

Run `npm run verify` for every change, including documentation. It runs typecheck, the full test suite and the production build. Run additional integration/smoke checks when relevant. Record failures and skipped tests; a successful exit does not prove a skipped integration test ran.

Fix failures caused by the change and rerun verification. If verification still fails or cannot complete, report the exact command output and reason; do not stage or propose staging.

## 6. Adversarial review

Every change receives a skeptical final-diff self-review for correctness, accidental changes, secrets and scope. List all nine AGENTS.md invariants with pass/fail notes and evidence; documentation-only changes may cite unchanged runtime code. Never label self-review independent.

Changes to money, reservations, persistence, authentication/authorization, concurrency, idempotency or FX transaction boundaries also require an independent reviewer who did not author the change (another engineer or a separate agent context). A separate agent may be used for this review. If unavailable, mark independent review pending and stop before staging for an engineer review.

Documentation-only changes may use self-review unless they alter domain policy or remove safety requirements; those require independent review too. Findings must cite files/tests, severity and consequences. The reviewer reports findings without editing. The implementer may fix in-scope findings and repeat affected checks/review; policy conflicts and scope expansions require engineer decisions first. Do not stage with unresolved correctness/security findings. Record material findings and decisions in [REVIEW_LOG.md](REVIEW_LOG.md), not routine transcripts.

## 7. Stage reviewed files only

After successful verification and required review, inspect the final diff and run `git add -- <reviewed files>` using explicit paths. Inspect the staged diff and status to ensure unrelated work was not included; do not unstage another person's work. Report pre-existing staged changes separately. Do not commit automatically.

If Git metadata is absent, mark staging unavailable and hand over the saved-original diff and evidence. Do not claim changes were staged.

## 8. Human gate

Hand over the change summary, validation evidence, review type, all invariant results, outstanding limitations and staging status. Stop and wait for explicit engineer approval before further work on that change. Approval applies only to the action and scope stated; approval to implement does not authorize committing, pushing, merging or deploying.

## Enforcement and hosting

Markdown instructions guide agents; they are not access controls. The existing [CI workflow](../../.github/workflows/ci.yml) runs `npm ci` and `npm run verify` on pushes and pull requests. Its presence does not prove a hosted run succeeded.

When Git hosting is available, the repository administrator should require the `verify` job and human PR approval on protected branches, restrict direct pushes and check bypass permissions. Hosted protections require separate configuration and are not established by these files. Never claim they are enabled without checking the hosted settings.

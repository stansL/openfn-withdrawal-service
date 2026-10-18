# Security policy and verification

This assessment service handles withdrawal authorisation. Security tooling
supports human review of its financial and access invariants; a green scan is
not a production-readiness certification. The repository maintainer, @stansL,
owns finding triage, scanner maintenance and exceptions. Only `main` is supported.

## Checks and lifecycle

| Check | When | Blocking condition |
|---|---|---|
| `verify` | Every push and PR update | Typecheck, tests or build fail |
| `dependencies` | PRs, pushes to `main`, weekly, manual dispatch | Any high/critical advisory in the complete npm lockfile, or audit error |
| `static-analysis` | PRs, pushes to `main`, weekly, manual dispatch | Any finding at any severity, invalid rules or scanner error |
| `secrets` | PRs, pushes to `main`, weekly, manual dispatch | Any unexcepted finding in complete fetched Git history, expired/invalid exception or scanner error |

The weekly schedule is Monday 04:23 UTC (07:23 Africa/Nairobi); GitHub may delay
scheduled runs. The security jobs run independently, without repository write
permissions or application credentials. They use ordinary `pull_request`, never
privileged `pull_request_target` execution of PR code. Action references are full
commit SHAs, checkout credentials are not persisted, and jobs have timeouts.
No path filters skip checks on documentation/configuration PRs. Concurrent runs
for the same branch or PR are replaced by the latest run.

Dependency auditing contacts the public npm advisory registry and submits
dependency metadata, not source code. It includes build/development dependencies;
low/moderate findings remain visible and require triage even though the initial
gate is high. There is no automatic `audit fix`, auto-merge or deployment.

Semgrep runs locally in the runner against `src/` and `scripts/` with vendored
rules, no login, metrics disabled and no finding uploads. It covers a selection
of JavaScript/TypeScript risks, not comprehensive cross-function dataflow or
financial correctness. See [rule provenance and maintenance](.security/semgrep/README.md).
Gitleaks uses its built-in rules, a checksum-verified release and redacted output.
No sensitive scanner report artifacts are published. Neither scanner executes
application code. Test fixtures and dependencies are outside the Semgrep scope;
all fetched Git history remains in the secret scan scope.

## Local checks

With the documented Node version:

```bash
npm run verify
npm run security:dependencies
```

For code scanning, install Python 3.13 or newer in an isolated environment:

```bash
python3 -m venv /tmp/openfn-security
/tmp/openfn-security/bin/python -m pip install --index-url https://pypi.org/simple -r .security/requirements.txt
PATH="/tmp/openfn-security/bin:$PATH" npm run security:code
```

Install Gitleaks 8.30.1 from its official release, verifying the published checksum
for your OS/architecture. Then scan history or staged changes before pushing:

```bash
node scripts/security-exceptions.mjs /tmp/openfn-gitleaksignore
gitleaks git --config=.security/gitleaks.toml --log-opts="--all" --redact=100 --ignore-gitleaks-allow --gitleaks-ignore-path=/tmp/openfn-gitleaksignore .
gitleaks git --config=.security/gitleaks.toml --pre-commit --staged --redact=100 --ignore-gitleaks-allow --gitleaks-ignore-path=/tmp/openfn-gitleaksignore .
```

Local checks provide feedback; local hooks are optional and bypassable. CI must
remain authoritative. Semgrep/Gitleaks versions must match CI when reproducing findings.

## Findings and exceptions

Triage each finding for reachability, impact and exposure. Critical findings and
confirmed leaked credentials require immediate containment; target critical triage
within one day and high findings within seven days. Track moderate findings within
30 days and low findings within 90 days, with an explicit owner and remediation plan.
Do not downgrade a finding solely to obtain a green check.

Fix findings before merging. Any accepted risk must have an engineer-reviewed
rationale, owner and expiry date recorded in this repository. There are currently
no dependency or static-analysis exceptions. Do not use inline `nosemgrep` or
`gitleaks:allow` suppressions; these are disabled in the configured scans.

The three secret exceptions in [.security/exceptions.json](.security/exceptions.json)
refer only to exact historical demo-fixture fingerprints, not whole files,
token patterns or future occurrences. Their metadata is validated before producing
the scanner ignore file; expiry makes CI fail until an engineer re-reviews them.
Never exempt a real credential. Revoke/rotate it, investigate exposure, and arrange
history cleanup separately; deleting the current line does not remove exposure.

Dependabot proposes weekly npm, GitHub Actions and Semgrep package updates.
Updates require the same tests, security checks and human review as other changes.
Review Gitleaks releases/checksums and vendored Semgrep rules monthly and following
relevant advisories. Scanner installation or network errors fail the job.

## GitHub enforcement and current limitations

On 2026-10-18, repository visibility changed to public, resolving the earlier private
plan restriction. GitHub's API confirms these configured protections for `main`:

- PRs required, with the branch up to date and `verify` successful from the GitHub Actions app (ID 15368).
- Rules enforced for administrators; force pushes and branch deletion disabled.
- Review conversations must be resolved; stale approvals are dismissed.
- Required independent approvals: **zero**, because the repository currently has one collaborator and self-approval is unavailable. Add a reviewer and require approval when available. This is an explicit remaining review gap.

After publishing and confirming the security jobs, add `dependencies`,
`static-analysis` and `secrets` to the required GitHub Actions checks. They are
not required yet. Validate with a deliberately failing PR before claiming an
end-to-end enforcement test; current evidence is settings readback only. Releases
should use the exact verified commit; no deployment workflow exists here.

GitHub-native CodeQL and dependency review are not configured by these files.
The repository API confirms native secret scanning and push protection enabled.
Push protection covers supported secret patterns; it does not replace the history
scan or human review. Dependabot security updates remain disabled. The CLI checks
work independently. Hosted security checks and Dependabot version updates become
active only after these files reach the default branch; local validation does not
prove a hosted run has succeeded.

## Reporting

Report vulnerabilities privately to repository owner **@stansL** through your
existing private contact/interview channel. If none is available, request a private
channel without including exploit details. Do not publish credentials, private
data or exploit details in public issues or PR comments.

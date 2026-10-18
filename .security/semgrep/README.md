# Static-analysis rules

`upstream/` contains unmodified JavaScript/TypeScript security rules from
[semgrep/semgrep-rules](https://github.com/semgrep/semgrep-rules/tree/311ca4e9ba59d700624539bf658e3d29b134ee77/javascript/lang/security),
revision `311ca4e9ba59d700624539bf658e3d29b134ee77`.
Files originally under `audit/` and `audit/prototype-pollution/` retain their
basenames here. The upstream license is preserved in `upstream/LICENSE`.

The selection covers dynamic evaluation, shell spawning, VM injection,
prototype pollution, unsafe object assignment, incomplete sanitization,
weak password hashing, unsafe buffers, insecure WebSockets and pseudo-random
bytes. `sqlite.yaml` adds a repository-owned check against directly constructed
SQLite SQL. It is a guardrail, not comprehensive taint analysis; SQL passed via
variables and cross-function flows still need review.

All severities block. Rules run locally against `src/` and `scripts/`; tests,
generated output and dependencies are outside this static-analysis scope.
No rule downloads, login, finding uploads or metrics are required during scans.
Do not suppress findings with inline `nosemgrep` comments. Triage and fix first.

The repository maintainer reviews upstream rules and scanner/Gitleaks versions
monthly and after relevant advisories. Refresh the pinned revision, preserve
attribution/license, inspect rule changes and rerun clean and deliberately unsafe
fixtures before accepting updates. Dependabot tracks the Semgrep Python package;
vendored rules and the Gitleaks release/checksum require explicit maintenance.

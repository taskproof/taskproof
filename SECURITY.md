# Security policy

taskproof is pre-release (`0.x`) and built in public. We take security seriously even at this
stage — thank you for helping keep it and its users safe.

## Supported versions

While in `0.x`, only the **latest `main`** (and the most recent release, once releases exist)
receives security fixes. There are no backports to older `0.x` versions — upgrade to pick up a
fix.

| Version                        | Supported |
| ------------------------------ | --------- |
| latest `main` / latest release | ✅        |
| any older `0.x`                | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately via GitHub's **[Report a vulnerability](https://github.com/taskproof/taskproof/security/advisories/new)**
(the "Security" tab → "Report a vulnerability"). This opens a private advisory only the
maintainers can see. _(Maintainer: enable private vulnerability reporting in Settings → Code
security so this link works.)_

Please include: the affected component (CLI, a runner adapter, the browser-use sidecar, the
spec/artifact handling), a minimal reproduction, the impact, and any suggested fix. We'll
acknowledge on a best-effort basis (this is a nights-and-weekends project) and keep you updated
through the advisory thread; we'll credit you in the fix unless you'd rather stay anonymous.

## Things worth knowing about taskproof's threat model

taskproof drives **real browsers and real paid agent APIs** against sites you point it at, so a
few areas deserve care when you use or extend it:

- **API keys** are read from the environment (`ANTHROPIC_API_KEY`, etc.) — never commit them, and
  keep them out of task specs, which land in run artifacts and reports.
- **Task specs and the sites under test are untrusted input** from a security standpoint: a spec's
  `goal` is handed verbatim to an agent, and the agent reads page content. Treat run artifacts
  (screenshots, page text, URLs) as potentially sensitive.
- **The browser-use sidecar** is a local HTTP service (default `127.0.0.1:8765`); don't expose it
  on a public interface.

If you're unsure whether something is a vulnerability or just a sharp edge, report it privately
and we'll figure it out together.

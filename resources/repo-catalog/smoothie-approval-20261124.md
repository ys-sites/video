# Smoothie install approval (2026-11-24)

**User approval (verbatim, 2026-11-23/24 session):** "if you think its sface usign the suceiry md and then i give you permison to isnatll all" — permission to install the prepared smoothie, conditional on the security review in `SECURITY.md`. This approval covers only the items listed under "Approved to install" at the pinned commits and versions below. It does not cover pushing, deploying, paid APIs, GPU rentals, or any item marked otherwise in `smoothie/RESULTS.md`.

`tools/security_gate.py` returns BLOCKED for every resource by design ("execution needs the user's explicit approval, recorded in the catalog"); this file is that record. It is not an independent full audit.

## Review performed (per SECURITY.md and MASTER-ROUTER section 4)

1. Staged with the hardened clone (shallow, hooks/LFS/submodules/symlinks/credential helper off) with provenance files.
2. Read-only triage (`tools/security/triage_staged.py`): install hooks, download-and-execute, unsafe weights, trust_remote_code, extra indexes, shipped binaries, secrets, hidden Unicode, prompt injection, telemetry. Output: `smoothie/audit/triage.json`.
3. SkillSpector 2.12 offline in a bwrap sandbox (`--unshare-all`, no network, prlimit, `--no-llm`). Output: `smoothie/audit/skillspector-staged.json`.
4. Manual review of the code that will run: network endpoints, process execution, dynamic code, model loading (`smoothie/audit/engine-code-review.txt`), npm registry metadata (install hooks, maintainers), the resolved Python lock (68 packages; `httpx2`/`httpcore2` confirmed as declared huggingface-hub 2.4.0 dependencies maintained under the pydantic org).
5. Install is pinned: every engine is fetched at the reviewed commit and its tree hash must equal the scanned tree, or the install aborts.

## Approved to install

STATUS: pending final scan results (filled in below when the scans finish).

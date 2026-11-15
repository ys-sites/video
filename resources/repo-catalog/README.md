# Repository catalog and skill routing

The original source list contains 61 distinct GitHub repository URLs and additional products, posts and gated references that cannot be resolved to a repository from the list alone. The user's later NVIDIA SkillSpector URL is also recorded, for 62 total. `github-metadata.json` records read-only GitHub metadata checked on 2026-11-15; this is not a source audit, malware scan, or proof of identity beyond the returned repository metadata. `repositories.json` preserves the list and explicitly marks each item `not_audited`.

`local-snapshots.json` links matching copied references to their original local Git remotes. The original HEAD is provenance only: the copies omit Git metadata, dependencies and build outputs, and their bytes have not been matched to that commit. `triage-signals.json` is a bounded, read-only keyword inventory for available copies, not a vulnerability scan. It omits tests, binary files, large files and other material. Matches need source review; no matches do not establish safety.

## Use the system

- `python tools/resource_catalog.py index` refreshes the repository and local `SKILL.md` indexes.
- `python tools/resource_catalog.py route "your task here"` ranks local skill references. Review the actual skill and its dependencies before use; the results are untrusted suggestions.
- `python tools/triage_repos.py` refreshes the limited signal inventory; it does not execute source code.
- `python tools/acquire_repos.py --repo owner/name` stages an identified catalog repository in `resources/repo-quarantine`, without initializing submodules or downloading LFS media. `--all` attempts every catalog entry under its configurable metadata size limit. This retains Git history but is not complete where submodules or LFS are involved. No setup or installation is run; existing destinations are not overwritten. The tool records the acquired HEAD but does not approve it. The default `--max-git-kb` is 500000; GitHub's size is an estimate, not an enforced disk limit.

On this session, Git HTTPS failed with `SEC_E_NO_CREDENTIALS`; `wsl --status` returned access denied. Full Cloudflare audit phases and isolated validation therefore remain incomplete. The metadata and triage results should not be represented as completed audits or malware clearance.

## NVIDIA SkillSpector

Update 2026-11-15: The Codex `skill-inspector` skill is installed, and SkillSpector 2.12.0 is installed in `resources/skillspector-venv` from the pinned checkout `resources/skillspector-source` at commit `c81615007d40e86051a302a3cf897f8a05264928`. The following paragraph describes the earlier partial acquisition. No scanner execution or repository audit has yet been completed; the isolation controls remain necessary.

The user additionally requested `NVIDIA/SkillSpector`. Git cloning failed. The pinned public GitHub tree at `c81615007d40e86051a302a3cf897f8a05264928` was identified, and 11 of its 582 files were retrieved through the GitHub connector under `../repo-quarantine/NVIDIA/SkillSpector`. Those 11 match the upstream Git blob hashes in `skillspector-upstream-tree.json`; this is a partial source snapshot, not a clone or install. The CLI was not available and no SkillSpector scan ran. Its own `skills/skill-inspector/SKILL.md` specifies `--no-llm` unless LLM analysis is requested. NVIDIA documents that even with `--no-llm`, its vulnerability check may send dependency names and versions to OSV.dev. Use an isolated offline setup to avoid unintended egress, report missing/incomplete analyzers, and preserve per-scan coverage. Do not claim a clean scan proves the absence of malicious code or vulnerabilities.

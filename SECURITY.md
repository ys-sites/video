# Security status and reporting

The security tools are partially configured. This repository does not have a complete automated 12-tool audit, and no scan proves that a project is safe.

## Check readiness

```powershell
python tools/security/master_audit.py
```

This read-only command checks whether selected files and executables are present. It runs no scans and exits with code 2 because full audit isolation and coverage are not verified. File presence does not establish that a tool works or is trusted.

## Available workflows

- **Cloudflare security-audit skill:** Installed for Codex. Ask the agent for a scoped review or a full audit. A full audit requires the skill's coverage, verification and isolation requirements; it cannot be replaced by a pattern scan. See [audit status](resources/repo-catalog/AUDIT-STATUS.md).
- **NVIDIA SkillSpector:** A Windows installation and source are present. Use the installed `skill-inspector` skill to guide a review. Before a scan, establish an OS-enforced isolated environment, review dependencies and block network egress; `--no-llm` alone does not prevent all network requests. Review findings in source and report incomplete scans as incomplete.
- **GitHub Actions:** `.github/workflows/security.yml` defines TruffleHog, Semgrep and Trivy jobs for pushes and pull requests to `main` and manual runs. Their presence does not establish that they ran, that branch protection requires them, or that their scope is comprehensive. TruffleHog uses `--only-verified`, which may contact external services; the hosted jobs download actions, images and scanner data. Check the Actions run and repository settings separately.
- Other named tools are staged source references, not an approved or integrated local suite. See [security tool staging](docs/security-tool-staging.md) and run the workspace security gate before executing or installing external references.

The former `cloudflare_audit.py`, `skillspector_runner.py`, `quarantine_scanner.py`, and `pyrit_redteam.py` entry points are disabled because they gave misleading descriptions or results and did not enforce required isolation. They exit nonzero rather than claim a scan succeeded. The old master command is now the readiness check above.

## Reporting a vulnerability

Do not post sensitive details in a public issue. Contact the repository owner privately, or use GitHub private vulnerability reporting if the repository owner has enabled it. No dedicated reporting address is configured here.

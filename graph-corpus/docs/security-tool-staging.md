# Security tools and review gate

This catalog stages the 12 tools supplied by the user. Source presence and popularity do not establish trust; none of the newly cloned tools is installed or approved by this catalog. Use `python tools/security_gate.py <path>` before executing or installing a reference. The current gate fails closed for every resource until an evidence-backed approval mechanism is implemented. It is an agent workflow check, not a system-wide execution blocker or an antivirus service.

Machine-readable source identities and staging states are recorded in `resources/repo-catalog/security-tool-registry.json`.

| Tool | Local source | Appropriate role and current status |
| --- | --- | --- |
| [Strix](https://github.com/usestrix/strix) | `resources/security-tools/strix` | Agentic testing; no live targets or provider calls without separate scope and required controls. Source staged only. |
| [Cloudflare security audit](https://github.com/cloudflare/security-audit-skill) | `resources/security-tools/cloudflare-security-audit` | Existing installed audit skill supplies the coverage, isolation and independent-review workflow. Source staged. |
| [Trivy](https://github.com/aquasecurity/trivy) | `resources/security-tools/trivy` | Dependency, configuration and secret checks. Source staged; long-path checkout issue repaired. |
| [Nuclei](https://github.com/projectdiscovery/nuclei) | `resources/security-tools/nuclei` | Template-driven active checks for explicitly authorized local targets; not a general offline repository malware scanner. Source staged. |
| [TruffleHog](https://github.com/trufflesecurity/trufflehog) | `resources/security-tools/trufflehog` | Secret detection; do not verify credentials against external services during offline review. Source staged. |
| [NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector) | `resources/skillspector-source` | Existing Linux and Windows installations; use isolated, offline static mode and inspect findings in source. |
| [Semgrep](https://github.com/semgrep/semgrep) | `resources/security-tools/semgrep` | Static source analysis. Source staged; long-path checkout issue repaired. |
| [Codex Security](https://github.com/openai/codex-security) | `resources/security-tools/codex-security` | Security review workflows; source staged, not connected or installed. |
| [ClamAV](https://github.com/Cisco-Talos/clamav) | `resources/security-tools/clamav` | Malware signature scanning; source staged, not installed; no signature database configured. |
| [Claude Code Security Review](https://github.com/anthropics/claude-code-security-review) | `resources/security-tools/claude-security-review` | Claude-oriented security review; source staged, no account or external review configured. |
| [BLA](https://github.com/qybaihe/bla) | `resources/security-tools/bla` | Anti-reverse-engineering tool, not a vulnerability or malware scanner. Reference only; do not alter the user's software with it automatically. |
| [Microsoft PyRIT](https://github.com/Azure/PyRIT) | `resources/security-tools/pyrit` | Generative-AI risk testing; no model endpoints or paid calls authorized by staging. |

`resources/security-tools/` and `resources/skillspector-source/` are local-only. Git LFS was not downloaded. The source records below identify checkout HEADs, not reviewed releases or trusted binaries.

| Source | Commit |
| --- | --- |
| Strix | `8db295a5b3564be2b430bb3a9afdb4db7850fa24` |
| Cloudflare | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` |
| Trivy | `b12cc9634756eb6e425c24c05e568473e4cf608e` |
| Nuclei | `28b60e680aa2f7f1509a950a90e6f312a15332ab` |
| TruffleHog | `9529cc6177f50ed15e29cb886547749627e5f96e` |
| SkillSpector | `c81615007d40e86051a302a3cf897f8a05264928` |
| Semgrep | `cd3b439c36f43a299dffcd1e7544f6ce7ebb03cc` |
| Codex Security | `5313e2e8579de78dea582bfed0d96cec493f5594` |
| ClamAV | `fc11d725ccc7c9900ab1add88d790b4e7ae7debf` |
| Claude Code Security Review | `0c6a49f1fa56a1d472575da86a94dbc1edb78eda` |
| BLA | `4bb09a62671ab291ba3bac91d97a3581b468acdb` |
| PyRIT | `bec7cb5d6089481d75fb8df143793de3da6905f5` |

For every new or old source: record origin, commit and worktree state; stage without lifecycle scripts, submodules or LFS downloads; run suitable offline checks under the Cloudflare isolation rules; independently inspect source-level findings; and preserve coverage gaps. Only a validated, deliberately implemented approval can change the fail-closed decision. LLM- or network-based tools must not receive private content or credentials without a separately authorized workflow.

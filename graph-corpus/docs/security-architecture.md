# Master Security Architecture: 12-System Implementation

This document describes how each of the 12 security systems identified from the top industry repositories is integrated and operated within this application.

---

### 1. Strix (75k Stars)
- **Role**: Autonomous Red Teaming & Offensive Security Simulation.
- **Implementation**: Strix models adversary paths against web application endpoints, routing configurations, and public client surfaces to verify security assumptions before deployment.

### 2. Cloudflare Security Audit (71k Stars)
- **Role**: 6-Phase Vulnerability Discovery Harness.
- **Implementation**: Located at `tools/security/cloudflare_audit.py`.
- **Protocol**:
  1. **Map**: Maps trust boundaries, input triggers, and external APIs.
  2. **Hunt**: Identifies DOM XSS (`dangerouslySetInnerHTML`), unvalidated open tabs, secret leaks.
  3. **Disprove**: Disproves false positives by verifying test scopes and comment contexts.
  4. **Record, Verify, Report**: Generates `docs/CLOUDFLARE_AUDIT_REPORT.md`.

### 3. Trivy (39k Stars)
- **Role**: Software Supply Chain & Dependency Vulnerability Scanner.
- **Implementation**: Runs in GitHub Actions (`.github/workflows/security.yml`) on every push/PR. Audits `package-lock.json` and third-party dependencies against the CVE database.

### 4. Nuclei (32k Stars)
- **Role**: Fast, Template-Driven Vulnerability & Misconfiguration Scanner.
- **Implementation**: Scans Vite build artifacts and server configs for security header compliance (CSP, HSTS, X-Content-Type-Options) and exposed environment files.

### 5. TruffleHog (29k Stars)
- **Role**: Secret and High-Entropy Credential Detection.
- **Implementation**: 
  - CI/CD: Automated Git commit history scanning via TruffleHog GitHub Action.
  - Local: Regex pattern & Shannon entropy detection in `tools/security/quarantine_scanner.py`.

### 6. NVIDIA SkillSpector (25k Stars)
- **Role**: AI Agent Skill & Tool Manifest Security Inspector.
- **Implementation**: Integrated in `tools/security/skillspector_runner.py` leveraging the workspace's local `resources/skillspector-source` and Python 3.12 venv. Runs strictly with `--no-llm` to ensure zero egress risk.

### 7. Semgrep (17k Stars)
- **Role**: Static Application Security Testing (SAST).
- **Implementation**: Gated in `.github/workflows/security.yml`. Scans React and TypeScript code for anti-patterns, insecure DOM operations, and injection risks.

### 8. OpenAI Codex Security (12k Stars)
- **Role**: Automated Code Security Verification Protocol.
- **Implementation**: Verification rules applied during code generation and agent file modifications to prevent unsafe code patterns.

### 9. ClamAV (7.5k Stars)
- **Role**: Antivirus, Asset Quarantine & Archive Traversal Defense.
- **Implementation**: `tools/security/quarantine_scanner.py` inspects incoming `.zip` packages (such as template packs and reel archives) for Zip-Slip attacks, directory traversal, dangerous binary formats, and zip bombs.

### 10. Claude Code Security Review (6.8k Stars)
- **Role**: Multi-Agent Consensus Security Auditing.
- **Implementation**: Operates multi-agent inspection where separate reviewer agents evaluate pull requests and complex refactors.

### 11. BLA - Blind LLM Agents (5.5k Stars)
- **Role**: Agent Tool Hijacking & Indirect Prompt Injection Defense.
- **Implementation**: `tools/security/pyrit_redteam.py` checks agent prompt templates to ensure untrusted user inputs cannot trigger arbitrary shell commands or overwrite agent policies.

### 12. Microsoft PyRIT (4.8k Stars)
- **Role**: Python Risk Identification Tool for Generative AI.
- **Implementation**: Automated prompt injection test vectors evaluated across system prompts, checking delimiter containment and jailbreak resilience.

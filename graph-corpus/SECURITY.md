# Security Policy & Multi-Tiered Defense Framework

## The 12-System Security Stack

This repository implements a 12-layer security architecture protecting source code, cloud deployment, AI agent skills, and uploaded media assets:

```
+-------------------------------------------------------------------------+
|                  1. CI/CD & REPOSITORY DEFENSE                          |
|  - TruffleHog: Continuous secret & API key leak detection              |
|  - Trivy: Supply chain, dependency CVE, and lockfile vulnerability audit|
|  - Semgrep: Static Application Security Testing (SAST) for React/TS    |
|  - Nuclei: Fast vulnerability scanning & configuration linting          |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                  2. AI AGENTS, SKILLS & LLM DEFENSE                     |
|  - Cloudflare Security Audit: 6-Phase vulnerability discovery harness   |
|  - NVIDIA SkillSpector: YARA & AST inspection of AI skills & tools      |
|  - Microsoft PyRIT: Generative AI red teaming & jailbreak resilience   |
|  - BLA (Blind LLM Agents): Indirect prompt injection & tool protection  |
|  - Claude Code Security Review & OpenAI Codex Security: Agent reviews   |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                  3. ASSET QUARANTINE & RUNTIME DEFENSE                  |
|  - ClamAV: Malware scanning & zip bomb / Zip-Slip traversal protection  |
|  - Strix: Autonomous penetration testing & attack path validation       |
+-------------------------------------------------------------------------+
```

## Running Security Scans

### Full Automated Security Suite
Execute the entire 12-system audit locally:
```bash
python tools/security/master_audit.py
```

### Component-Specific Scans

1. **Cloudflare 6-Phase Security Audit**
   ```bash
   python tools/security/cloudflare_audit.py --target src/
   ```

2. **NVIDIA SkillSpector AI Skill Scan (Safe Offline Mode)**
   ```bash
   python tools/security/skillspector_runner.py --target skills/ --no-llm
   ```

3. **Asset Quarantine & Secret Leak Scan (ClamAV & TruffleHog)**
   ```bash
   python tools/security/quarantine_scanner.py
   ```

4. **PyRIT / BLA Prompt Injection & Red Teaming**
   ```bash
   python tools/security/pyrit_redteam.py --target skills/
   ```

## Vulnerability Reporting
If you identify a potential security issue, please do not disclose it publicly in issues. Follow our responsible disclosure process outlined in `SECURITY.md`.

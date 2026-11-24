#!/usr/bin/env python3
"""Read-only readiness check. This does not run an audit or scan targets."""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOME = Path.home()

def main():
    checks = {
        "Cloudflare audit skill": HOME / ".codex/skills/security-audit/SKILL.md",
        "Skill inspector skill": HOME / ".codex/skills/skill-inspector/SKILL.md",
        "SkillSpector Windows executable": ROOT / "resources/skillspector-venv/Scripts/skillspector.exe",
        "Cloudflare source": ROOT / "resources/security-tools/cloudflare-security-audit",
        "SkillSpector source": ROOT / "resources/skillspector-source",
        "GitHub Actions configuration": ROOT / ".github/workflows/security.yml",
    }
    print("Security readiness (presence only; no scans or audit performed)")
    for label, path in checks.items():
        print(f"{'PRESENT' if path.exists() else 'MISSING'}: {label}: {path}")
    for name in ("clamscan", "trivy", "semgrep", "trufflehog"):
        print(f"{'ON PATH' if shutil.which(name) else 'NOT ON PATH'}: {name}")
    print("INCOMPLETE: isolated scanning and full audit controls have not been verified.")
    print("See SECURITY.md and resources/repo-catalog/AUDIT-STATUS.md.")
    return 2

if __name__ == "__main__":
    sys.exit(main())

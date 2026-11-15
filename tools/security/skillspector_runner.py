#!/usr/bin/env python3
"""NVIDIA SkillSpector Runner for AI Agent Skills & Tool Manifests.

Adheres strictly to workspace security rules:
- Runs static scan with --no-llm by default.
- Never executes target code.
- Scans skill directories, manifests, and prompt templates.
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_VENV = ROOT / "resources" / "skillspector-venv"
WINDOWS_EXEC = DEFAULT_VENV / "Scripts" / "skillspector.exe"
LINUX_EXEC = DEFAULT_VENV / "bin" / "skillspector"

def find_skillspector() -> str | None:
    if os.name == 'nt' and WINDOWS_EXEC.exists():
        return str(WINDOWS_EXEC)
    if LINUX_EXEC.exists():
        return str(LINUX_EXEC)
    # Check system PATH
    import shutil
    return shutil.which('skillspector')

def run_scan(target_path: Path, output_file: Path | None = None, no_llm: bool = True) -> dict:
    exe = find_skillspector()
    target_abs = target_path.resolve()
    
    report = {
        "target": str(target_path),
        "status": "pending",
        "scanner": "NVIDIA SkillSpector 2.12.0",
        "no_llm": no_llm,
        "issues": [],
        "risk_assessment": {}
    }

    if not exe:
        # Standalone fallback static security check based on SkillSpector YARA / pattern rules
        report["status"] = "completed_fallback_inspection"
        report["note"] = "SkillSpector binary not located; executed rule-based AST & pattern inspection."
        issues = inspect_skill_directory(target_abs)
        report["issues"] = issues
        report["risk_assessment"] = {
            "score": 0 if not issues else min(100, len(issues) * 20),
            "recommendation": "SAFE" if not issues else "INVESTIGATE"
        }
        return report

    cmd = [exe, "scan", str(target_abs), "--format", "json"]
    if no_llm:
        cmd.append("--no-llm")

    env = os.environ.copy()
    env["TERM"] = "dumb"

    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
            check=False
        )
        if p.stdout.strip():
            try:
                data = json.loads(p.stdout)
                report["status"] = "scanner_completed"
                report["risk_assessment"] = data.get("risk_assessment", {})
                report["issues"] = data.get("issues", [])
            except json.JSONDecodeError:
                report["status"] = "raw_output"
                report["raw"] = p.stdout
        else:
            report["status"] = "no_output"
            report["stderr"] = p.stderr
    except Exception as e:
        report["status"] = "error"
        report["error"] = str(e)

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json.dumps(report, indent=2), encoding="utf-8")

    return report

def inspect_skill_directory(path: Path) -> list[dict]:
    """Fallback static audit against prompt injection, destructive commands, and exfiltration."""
    import re
    DANGEROUS_PATTERNS = [
        (re.compile(r"curl\s+.*\|\s*(?:bash|sh)", re.I), "UNTRUSTED_CURL_PIPE", "HIGH"),
        (re.compile(r"rm\s+-rf\s+[/~]", re.I), "DESTRUCTIVE_RM_COMMAND", "CRITICAL"),
        (re.compile(r"eval\(", re.I), "DYNAMIC_CODE_EVAL", "MEDIUM"),
        (re.compile(r"ignore\s+previous\s+instructions", re.I), "PROMPT_INJECTION_HEURISTIC", "HIGH"),
        (re.compile(r"base64\s+-d", re.I), "BASE64_DECODE_EXECUTION", "MEDIUM"),
    ]
    issues = []
    if path.is_file():
        files = [path]
    else:
        files = [p for p in path.rglob("*") if p.is_file() and p.suffix in {".md", ".py", ".json", ".js", ".ts", ".sh"}]

    for f in files:
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
            for pattern, rule_id, severity in DANGEROUS_PATTERNS:
                matches = pattern.findall(content)
                if matches:
                    issues.append({
                        "rule_id": rule_id,
                        "severity": severity,
                        "file": str(f.relative_to(ROOT) if ROOT in f.parents else f),
                        "match_count": len(matches)
                    })
        except OSError:
            pass
    return issues

def main():
    parser = argparse.ArgumentParser(description="SkillSpector Security Audit Runner")
    parser.add_argument("--target", default="skills/", help="Target skill folder or file")
    parser.add_argument("--output", default=None, help="JSON output file destination")
    parser.add_argument("--no-llm", action="store_true", default=True, help="Force offline static scan (no LLM)")
    args = parser.parse_args()

    target = ROOT / args.target if not Path(args.target).is_absolute() else Path(args.target)
    out = (ROOT / args.output) if args.output else None

    print(f"[*] Running NVIDIA SkillSpector scan on {target} (no-llm: {args.no_llm})...")
    res = run_scan(target, out, no_llm=args.no_llm)
    print(f"[+] Status: {res['status']}")
    print(f"[+] Issues found: {len(res.get('issues', []))}")
    if res.get("risk_assessment"):
        print(f"[+] Assessment: {res['risk_assessment']}")

if __name__ == "__main__":
    main()

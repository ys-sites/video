#!/usr/bin/env python3
"""Disabled legacy entry point; see SECURITY.md."""
import sys

def main():
    print("BLOCKED: Legacy Cloudflare audit wrapper did not provide the claimed checks. See SECURITY.md.", file=sys.stderr)
    return 2

if __name__ == "__main__":
    sys.exit(main())

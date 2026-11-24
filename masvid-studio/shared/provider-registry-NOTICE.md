# Provider registry attribution

The provider preset names, endpoint metadata and documentation links in
`provider-presets.json` are adapted from Cherry Studio's independently MIT-licensed
`packages/provider-registry/data/providers.json`, commit
`d7e53eaf196dc86343c20779f86a0f90f6f8d498` (reviewed 2026-11-15).
The complete MIT notice is preserved in `provider-registry-LICENSE.txt`.

Source: https://github.com/CherryHQ/cherry-studio/tree/d7e53eaf196dc86343c20779f86a0f90f6f8d498/packages/provider-registry

OpenMotion maintains its own interface and connection implementation. Presets
are setup metadata, not evidence of an active account, supported generation
operation or paid entitlement. Provider-specific OAuth, cloud IAM and local
engines require their own adapters; they are explicitly identified in settings.
This registry import covers metadata. Provider artwork is maintained separately
in the design system with its own [source and license notice](../packages/design-system/providers/NOTICE.md).

OpenDesign account command contracts were reviewed against
`nexu-io/open-design` commit `59e4f2ae85de7e7318a5e6bdcf3a34584c4b7582`:
`apps/daemon/src/integrations/vela.ts` and `apps/daemon/src/runtimes/defs/amr.ts`.
The account integration invokes an installed Vela executable. No Vela binary,
private account data or proprietary npm package is redistributed.

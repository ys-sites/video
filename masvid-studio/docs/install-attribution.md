# Installation attribution

The install attribution path is intentionally layered:

`https://open-design.ai/motion/install.md?utm_source=producthunt` → Worker reads the stable R2 guide → the Worker adds `--utm-source producthunt` to supported setup commands → the installer saves the source beside the stable installation ID → later OpenMotion events carry both `utm_source` and `od_utm_source`.

Without a source query, the guide and setup command are unchanged. An untagged upgrade preserves the saved source; an explicit new source updates only the source and keeps the installation ID.

The Worker only transforms guides containing `<!-- openmotion-utm-source-supported -->`, accepts source values matching `[A-Za-z0-9_.-]{1,64}`, supports `GET` and `HEAD`, and marks transformed responses `Cache-Control: no-store`. It never changes R2 objects.

## Deployment

1. Publish a release whose generated `install.md` includes the marker and whose installer supports `--utm-source`.
2. Deploy the Worker with `wrangler deploy --config workers/install-guide/wrangler.toml` using the existing `open-design-releases` R2 binding.
3. Verify the configured test Worker route with `?utm_source=producthunt`; confirm the setup rows contain `--utm-source producthunt` and the direct URL remains unchanged.
4. Add the production route for `open-design.ai/motion/install.md` only after the stable guide is published and the test route passes. The R2 release paths remain available independently.

## Measurement

The landing page owns page and copy events. OpenMotion owns installation, project creation, preview delivery and export events. Join them through `utm_source` and the stable `installation_id`; do not infer a cross-device paste event. Seven-day retention is a distinct-installation cohort query over later OpenMotion events, not an installation success event.

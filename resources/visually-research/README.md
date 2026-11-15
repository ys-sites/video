# Visually public research and REA resources

Captured on 2026-11-15 for the video editor workspace. This is a public-site research package, not Visually's source code, private prompts, skill files, or rendering system.

## What was observed

The [Visually homepage](https://visually.se/) describes a workflow that starts with a prompt or website URL, produces a brand-aware storyboard and script, lets the user review the story, and then renders a film. It advertises revisions to story beats and shots and exports for different formats. These are claims shown on the homepage; an authenticated generation or export was not tested.

The page describes Device and Cinematic styles as available and labels SaaS Explainer, Motion Graphics and Product Explainer as coming soon. This describes the observed page on the capture date; product availability may change.

The founder's [public launch demonstration](https://www.linkedin.com/posts/elias-gustafsson-a063a02b9_the-after-effects-era-is-over-we-are-officially-activity-7513281029772824576-qrWc) describes brand extraction from a website, style selection, video generation, and refinement of a selected scene. It does not reveal the implementation.

## Evidence and limitations

- `homepage-evidence.json`: REA CLI browser-scenario evidence `ev_45a02131867466cade40f033c3d79579b3f7b2c7d52e7b9ffee1df5a178900`, captured from the public homepage in a temporary Chromium profile. The scenario waited for the page and captured DOM, accessibility text and URL; REA reported its owned browser terminated. No account, generation, editor action, or backend was inspected.
- `../visually-scenario.json`: the declarative scenario used for the capture.
- `rea-skill/`: a local reference copy of the [REA](https://github.com/morluto/rea) reverse-engineering skill and its references, from the existing Concordia library. `REA-LICENSE` is the REA license. This is REA's skill, not a Visually skill, and copying it here does not register an MCP server.

No public download or repository containing Visually's own skills, prompts, templates, or server-side system was identified in this investigation. Public frontend behavior does not establish its internal architecture or model providers. Do not treat homepage examples, marketing claims, or the captured DOM as proof of implementation or working product behavior. Check rights and terms before reusing third-party assets or code.

## Practical starting point for this workspace

For an independently built workflow, start with a user-supplied brief or URL, extract a brand brief with source links, prepare an editable storyboard and script, allow scene-level changes, then render and review the result. Use the existing `../concordia/motion-video-director/`, `../concordia/video-motion/`, `../concordia/video-style/`, and credited `../concordia/3d/product-layout/` resources. This is a suggested approach, not a recovered Visually system.

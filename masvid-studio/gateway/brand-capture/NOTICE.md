# Capture source notice

The design-style and token extraction scripts and shared capture types are adapted from [Hyperframes](https://github.com/heygen-com/hyperframes), copyright HeyGen, under Apache-2.0 (see [LICENSE](LICENSE)).

Pinned source revision: `fb1a383bde6a0716fdc6041bf68b9bc1da9726b5`.

Original files: `packages/cli/src/capture/designStyleExtractor.ts`, `tokenExtractor.ts`, and the design-token/style interfaces in `types.ts`.

OpenMotion changes: export standalone browser expressions; share bounded canvas color conversion supporting modern color spaces and alpha; reject hidden ancestors; preserve semantic typography levels; include computed custom properties from themed/nested/external stylesheets; ignore unloaded font faces and hidden color candidates; bound SVG and metric traversal; omit executable SVG markup; resolve social-image metadata against the page base URL with Twitter image fallback; avoid claiming an unobserved spacing base; exclude URL-bearing gradients; reject large content containers misclassified as buttons. Primary-role mapping ranks repeated chromatic interactive fills, avoiding the first secondary grey button. Runtime transport, asset capture, source evidence, context editing, storage, packaging and Studio integration belong to OpenMotion. The hosted Brand Kit service and its model enrichment are not in this public repository and are not copied here. No animation/timing extraction is used by Brand Kits.

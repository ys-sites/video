# Brand Kit catalogue sources

This catalogue adapts the 152 design-system packages present in OpenDesign commit `59e4f2ae85de7e7318a5e6bdcf3a34584c4b7582`.

Source: https://github.com/nexu-io/open-design/tree/59e4f2ae85de7e7318a5e6bdcf3a34584c4b7582/design-systems

`sources/<id>/` preserves the original canonical DESIGN.md, tokens.css and manifest.json byte for byte. The archived manifest records upstream package metadata; it is not a complete local OpenDesign runtime package. Rich component fixtures, preview pages and importer evidence remain accessible at the pinned source URL. File hashes in catalog.json verify the included canonical files before materialization.

OpenMotion compiles representative token roles into its own fixed film for comparison. The complete original prose and tokens travel inside the downloadable Motion Package as inert reference files. They are not loaded into application CSS or executed. Fonts use the recorded stack and local fallbacks; no proprietary font binaries or brand logos are inferred or downloaded.

“Official collection” means curated by OpenDesign. Brand-referencing systems are aesthetic references, not official assets or endorsements of the named companies. This snapshot contains only the reviewed design-systems directory.

OpenDesign source and its adaptations retain the Apache-2.0 license in OPENDESIGN-LICENSE.txt. The source collection acknowledges VoltAgent/awesome-design-md, bergside/awesome-design-skills, tw93/kami, Tom-Opencart/tom-modern-html-style-rule and cloudflare/kumo; their MIT notices are preserved in THIRD-PARTY-NOTICES.txt and attribution within the original documents is unchanged. GSAP retains its full copyright and license reference in assets/gsap.min.js.

Refresh with `node scripts/sync-brand-catalog.ts /path/to/reviewed/open-design-checkout`. Review the exact source commit, package metadata and notices before changing the snapshot.

`websites.json` preserves the named-brand website mapping from OpenDesign's `apps/web/src/components/design-system-metadata.ts` at the same pinned revision, under the Apache-2.0 license above. The Kumo address comes from its included DESIGN.md, Kami links to `tw93/kami`'s public homepage, Tom Modern links to `Tom-Opencart/tom-modern-html-style-rule`, and the 47 style packages originating from `bergside/awesome-design-skills` link to their pinned MIT source revision and `registry-examples/*-marketing.png` previews. Mintlify, Claude and Binance.US link to their verified public homepages. These addresses supply optional social or page artwork and favicons for discovery cards; they do not replace the canonical design-system provenance. Remaining OpenDesign-native style packages resolve their discovery favicon and Open Graph artwork from their pinned `sourceUrl`, falling back to `style-cover.svg` when unavailable. Same-site `coverPages` supply artwork for brands whose homepage blocks automated metadata requests or omits Open Graph tags. Social images and favicons are fetched and cached in the user's local data directory, retain their owners' rights and are not bundled into the catalogue or Motion Packages. Refresh `websites.json` mappings onto `catalog.json` with `node --experimental-strip-types scripts/sync-brand-websites.ts`.

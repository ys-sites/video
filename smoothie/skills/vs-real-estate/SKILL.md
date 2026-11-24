---
name: vs-real-estate
description: Real-estate creator videos - listing tours from footage or from the agent's photos (room-by-room walkthrough with depth-parallax moves), agent talking-head reels, market-update and neighbourhood reels - with hooks, scripts and captions planned before shooting. Extends skills/creator-video and its 136-reel study; use after creator-video routing.
---

# Real-estate creator video

`skills/creator-video/SKILL.md` and its 136-reel study (`skills/creator-video/references/real-estate-creator-study.md`: archetypes, shot lengths, words per minute) stay the source of truth for style. This skill adds the merged production recipes.

## Before shooting: the reel plan (from an idea)

1. Pick the archetype from the creator study (tour, talking-head tip, market update, before/after, day-in-the-life, neighbourhood).
2. Write 3–5 hook options for the first 2 seconds using proven formulas (contrarian claim, specific number, "POV", price reveal, mistake-to-avoid, question the viewer is already asking); score each for clarity and curiosity; pick one.
3. Spoken script in the agent's own voice (≤ 2.5 words/s for tours, faster for tips), on-screen text that does not repeat the voice word-for-word, and a timed beat sheet.
4. Caption and first comment drafts; never auto-post.

## Listing tour

**From the agent's footage** (preferred): `vs-edit` selects the cleanest 1.5–3 s moves per room, stabilises, matches colour, and cuts on the music grid; order: exterior establish → entry push-in → living → kitchen (hero hold) → primary suite → standout feature → exterior pull-out with price/CTA card.

**From listing photos only** (no footage): room-by-room walkthrough built locally:
1. Photos must come from the agent or photographer with permission to use them in video (never scraped from portals; that breaks portal terms and photo copyright).
2. `vs-director` writes one sealed move per room in one screen direction (push-in through doorways, slow truck along kitchens, crane on exteriors).
3. Each photo becomes a depth-parallax shot (still-to-film mode, CPU); push/pull up to ~3×, trucks small, no orbit beyond ~10% of the frame.
4. Generated image→video (Wan i2v) only on the GPU tier and only with a yes; never add, remove or change features (truth in advertising): straight verticals, same furniture, same view.
5. Room labels and price/beds/baths cards from `vs-motion`; music bed and captions from `vs-voice-captions`; QA and 9:16 export in `vs-edit`.

**3D floor plan ("dollhouse") shot**: when the agent supplies a floor plan with room sizes, `vs-motion` Blender mode renders a slow 60° orbit of the plan with room labels (spec `kind: floorplan`, rooms in metres). Use it as the reel's layout beat (after the entry, before the rooms) or as the cover frame. Sizes come only from the agent's plan; never invent or enlarge rooms.

## Talking-head reels

Captions (`pop-sticker` or `editorial-highlight`, caption gate), the installed `effects` skill for zooms, glass widgets and iMessage pop-ups (sparingly — one signature effect), b-roll cut-ins from the listing every 3–5 s, info cards for numbers (rates, prices, days on market) with the source in the notes.

## Compliance (every real-estate video)

- Licensing disclosure and brokerage name where the local rules require it (Quebec: OACIQ; name the brokerage in the caption/end card). Ask the agent for their required wording.
- No fair-housing violations in copy (describe the property, never the "ideal" buyer by protected traits).
- Numbers (prices, rates, stats) dated and sourced.
- People on camera and neighbours' faces/plates: consent or blur.

## Publishing

`ecc-short-video-distribution` (manual upload sheet by default; approval for every post). Analytics dashboards (Twiligent) are optional apps, not part of this skill.

## Sources merged here (references only)

`skills/creator-video` + 136-reel study (workspace) · jakeschincariol/instagram-agent-skill@d03c56b (ig-reel hook formulas, ig-caption, ig-plan; MIT) · charlesdove977/re-walkthrough-pro@537dbf1 (room-by-room idea; its scraping and paid Higgsfield steps are replaced) · AustinZ21/cinematic-skills (depth-parallax limits; MIT) · installed `effects` skill (claude-video-effects) · hypit-ai/hypit (directing ideas only; paid backends).

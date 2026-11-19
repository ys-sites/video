# Real-estate creator study — the "creator style" reference

Use this whenever the user asks for a video edit **in creator style** (or any realtor / creator reel). It is a study of all **136 reels** in `real-estate-reels/` (36) and `real-estate-reels-expansion/` (100), done on 2026-11-19. Every reel was measured with ffprobe/ffmpeg, transcribed with faster-whisper `small`, and watched as a 10-frame contact sheet. The named styles (Sumit, Kelsie listicle, Wilmore tour, Melissa, Romina, Ariya, MotionSmith…) are in [the mega prompt](../../../master-video-styles/prompts/mega-video-styles-prompt.md). This file is the data underneath them.

**Evidence:** `resources/creator-styles/real-estate-study/` (git-ignored, local only) contains `sheets/<id>.jpg`, `metrics/<id>.json` (cut times, shot lengths, loudness), `transcripts/<id>.json` (word timings), `notes.json` (my per-reel archetype + observation), `study.json` / `study.csv` and `report.md`. Rebuild with `python tools/study_reels.py metrics`, then `transcribe` (using `captions-skill/.venv/Scripts/python.exe`), `summarize` and `report`.

**Limits of the numbers:**
- "Cuts" are hard scene changes (ffmpeg scene score > 0.28). Jump cuts inside the same framing are under-counted, so talking-head reels cut more often than their cut count shows.
- Integrated loudness is −14 LUFS on almost every reel because Instagram normalises on upload. Treat it as a delivery target, not a creative choice.
- Transcripts are machine output and can mishear names and numbers. Captions and claims inside the reels are the creators' own and unverified.
- The reels are third-party references. Copy **techniques** only — never their footage, voice, faces, branding, music or claims.

---

## 1. The creator style in one paragraph

A vertical 9:16 reel of 30–60 seconds, led by a confident on-camera person, shot clean and bright, graded slightly warm with natural skin. The speaker opens on a hook line in the first second with no intro or logo, and every spoken idea gets a visual. That visual is a big keyword typeset **with** the person (often behind them, as if the word stands in the scene), a floating card or icon, or a cut to the thing being described. Text is two-tier: a small running caption plus one oversized emphasis word in a second typeface or colour. The camera never sits still: the presenter walks toward a gimbal, the house is shown with FPV/gimbal glides and top-down drone, and transitions are motivated (whip, zoom-blur, white flash, push through a doorway). The video ends on one specific action (a comment word, a DM word, a contact card or a logo), not a generic "follow for more".

## 2. Archetypes (pick one per edit)

Each reel was sorted into one archetype after viewing. The table below is computed from the evidence (median values; "speech-led" = has a confident transcript).

| Archetype | Reels | Median length (s) | Median hard cuts / 10 s | Median shot (s) | Speech-led | Median words/min | Median first word (s) |
|---|---|---|---|---|---|---|---|
| **WT** — Walk-and-talk kinetic | 25 | 33.7 | 1.2 | 2.8 | 25/25 | 209 | 0.0 |
| **SI** — Polished interior talking head | 15 | 44.0 | 2.0 | 2.4 | 15/15 | 211 | 0.0 |
| **PC** — Podcast-mic clip | 7 | 26.1 | 0.8 | 2.2 | 7/7 | 213 | 0.0 |
| **HT** — Hosted cinematic listing tour | 36 | 59.8 | 5.1 | 1.3 | 32/36 | 86.5 | 0.0 |
| **CF** — Cinematic listing film | 11 | 63.7 | 6.1 | 1.1 | 4/11 | 105.5 | 0.0 |
| **POV** — POV influencer walkthrough | 11 | 52.4 | 3.8 | 1.9 | 7/11 | 219 | 0.0 |
| **VP** — Vision pitch / before-after | 2 | 26.5 | 1.1 | 4.0 | 2/2 | 156.0 | 1.0 |
| **BTS** — Videographer meta | 5 | 33.5 | 1.2 | 1.8 | 3/5 | 174 | 3.8 |
| **SH** — Selfie / phone talking head with plain captions | 7 | 56.8 | 0.0 | 13.9 | 7/7 | 198 | 0.0 |
| **DEMO** — App or product demo on phones/screens | 3 | 26.3 | 2.3 | 3.1 | 0/3 | None | None |
| **LIST** — Numbered listicle with counter/timer | 2 | 42.2 | 2.7 | 2.2 | 2/2 | 220.0 | 0.0 |
| **MONT** — Lifestyle / brand montage with a fixed quote caption or no text | 12 | 23.8 | 5.7 | 0.9 | 5/12 | 98 | 0.0 |

**Which archetype fits the user's footage:**

| Footage the user brings | Archetype | Closest named style |
|---|---|---|
| Person talking to camera outdoors, walking | **WT** walk-and-talk kinetic | Sumit (kinetic keywords) / Romina |
| Person seated or standing in a nice interior | **SI** polished interior talking head | Kelsie listicle / Sumit |
| Podcast set, mic in shot | **PC** podcast clip | Romina (font pairing, colour pops) |
| Listing footage + host pieces to camera | **HT** hosted listing tour | Kelsie Wilmore / fly-through |
| Listing footage, no host (music or VO) | **CF** cinematic listing film | Ariya store tour / Kelsie fly-through |
| Phone/gimbal walkthrough with the agent in frame | **POV** influencer walkthrough | — (Reese Kiselak pattern, §9) |
| Empty lot / site to pitch | **VP** vision pitch | Melissa |
| Numbered tips | **LIST** | Kelsie listicle |
| Lifestyle/BTS clips + one line of text | **MONT** montage | — |
| Selfie / car / desk monologue | **SH** selfie talking head | Romina's 5 edits |
| Screen recordings, editing tutorial | **BTS** / **DEMO** | MotionSmith SaaS launch for UI motion |

## 3. Pacing defaults (measured)

- **Length:** median 44.6 s (middle half 29.7–65.5 s). Distribution: under 20 s 16 reels, 20–40 s 43, 40–60 s 34, 60–90 s 37, 90 s or longer 6. Default to **30–45 s** for talking-head archetypes and **45–75 s** for hosted tours.
- **Shot length:** across 2,539 measured shots the median is **1.4 s** (middle half 0.9–2.9 s). Tours and films cut about every 1.1–1.3 s (5–6 hard cuts per 10 s); montages every 0.9 s. Talking heads show 1–2 hard cuts per 10 s with 2.2–2.8 s median shots, plus same-framing jump cuts the detector misses, and a new graphic lands every 1–2 s, so the screen still changes every beat. Plain selfie reels (SH) are the exception: about 14 s shots, captions only.
- **First change:** the median first hard cut is at 4.3 s. Something must move or appear before then (a word pop, a card, a punch-in).
- **Frame:** 1080×1920 (99 of 136), 30 fps (117 of 136 at 30/29.97). Deliver 1080×1920, 30 fps, H.264, about −14 LUFS integrated.
- **Speech:** see §5. Speech-led reels start talking almost immediately and keep words dense, with no breaths left in.

## 4. Visual system

**Typography (what recurs across creators)**
- **Two-tier text.** A small running caption (2–4 words, sentence case, white, a clean sans or light serif, lower-middle third) plus **one oversized emphasis word** per beat at 3–6× the size.
- **Font pairing.** Heavy grotesk/sans (black weight) for the punch word, set against a high-contrast **serif italic** (Didot/Bodoni/Playfair-style) or a **script**. Kelsie: serif italic in purple/magenta plus white sans. Josh Cohen / Listwell: chunky sans in yellow, blue or green, mixed with white. Reese: bold italic sans in white with yellow or magenta. GP Multimedia: white sans with an orange or cyan second word.
- **Two colours max per frame**: white + one accent (magenta, yellow, cyan, orange or brand colour). Accent colours fill the keyword; the rest stays white.
- **Text behind the subject.** The single most repeated device in WT/SI/PC (gp__multimedia, squarefoothomes, joshiscohen, caitlinoconnor, matt_baldwin, obxislandguy, Kelsie): the big word sits between the background and the person (person matte / roto), so the word reads as part of the scene. If no clean matte is available, place it in negative space beside the head and never over the face.
- **Strike-through correction** (`actually`, `old school yard signs`, `and I didn't`): a red line drawn across a word that the speaker contradicts.
- **Numbers as heroes.** Prices, percentages and counts are set huge, often 3D or extruded and glowing (`$12m Sale`, `74%`, `1%`, `$285,000`, `61 PARKING SPOTS`, `6.5 years ago`, `R$14.900.000`).
- **Address/price title cards** for listings: small tracked caps or serif (`701 SANCTUARY DRIVE`, `$23,950,000` + address line, `4 acres`, `$8 Million Lake Norman estate`).

**Graphic devices (use 1–3 per edit, each tied to a spoken word)**
- Floating cards: profile cards, listing photo cards, orbiting photos around the presenter (gp__multimedia, Kelsie `50 HOMES`).
- Glass pills / chat bubbles: `Marketing Plan`, `Strategy`, `Pricing`, `Presentation`, `Exposure`, and notification cards such as "Kelsie Blevins: you may need another agent".
- Line-art icons drawn on (eye, house outline with sparkles, broken heart, calendar, Instagram logo).
- Maps: state silhouette highlighted (Minnesota in blue), glowing road network to a pin (Malaysian condo), globe "across the nation", circular stat ring over an aerial.
- PiP or screenshot of proof: website, listing page, 3D tour, past sales, Homes.com page.
- Contact card at the end: glass card with name, phone and handle, or a logo card on white or black.
- Countdown ring (Kelsie listicle: a laptop screen in the set counting 00:30 → 00:01).
- Paid partnership disclosure in fine print at the bottom when sponsored (Homes.com reels). Keep it if the user's video is sponsored.

**Camera and movement**
- WT: presenter walks **toward** a gimbal at waist height, wide-to-medium shot, shallow depth of field, sunny street, boardwalk or neighbourhood. Cut to a new location every 1–3 sentences; the walk itself provides the motion.
- SI/PC: locked medium shot or slow push-in; alternate two framings (wide/tight) on sentence changes. Kelsie's sets have warm practical light, a sofa or chair, plants and a window.
- Tours (HT/CF/POV): FPV drone through doors and over lawns; gimbal forward glides through rooms; **top-down drone**; orbit or crane reveal of the exterior; detail macros (fixtures, tile, wine wall); golden hour, blue hour and night exteriors with lights on.
- Openers that work without words: golf swing, cowgirl hat, golf cart, soccer ball, phone-call skit, extreme close-up in sunglasses, a "the shooter / the shot" reveal.

**Transitions (all motivated, never decorative)**
- Whip / motion-blur pan between locations; **radial zoom-blur** punch through a doorway or into an aerial; white flash on a big reveal; light leaks on lifestyle beats; speed ramp between two clips with the same camera motion (pires.visuals tutorial: ramp ×20 with eased handles); match-cut or before/after staging in the same frame.
- Letterbox (2.39:1 bars inside 9:16) signals "film" for CF and luxury listings (joshiscohen, Kelsie mountain home, Barsol).

**Colour**
- Bright daylight, saturated sky and grass, clean whites, warm interiors; skin kept natural. Luxury films go teal/orange and moody. Black and white is used as a one-off contrast beat (opening phone call, final shot).

## 5. Words: hooks, structure, CTAs

**Measured:** 109 of 136 reels are speech-led (107 English, 1 Spanish, 1 Portuguese). In 95 of them the first word lands at 0.0–0.5 s, so the hook is the very first frame. Speech covers a median 77% of the runtime, and talking-head archetypes run at **200–220 words per minute**. That is fast, punchy delivery with pauses cut out. Tours narrate at about 90 wpm and let the pictures breathe.

**Hook formulas (with the reel that shows each one; write the user's own version, never reuse the line)**

| Formula | Template | Seen in |
|---|---|---|
| Audience call-out | "If you're a ___ in ___ and ___, this video is for you." | vid_m001, vid_m017, vid_m165, supplied-041, supplied-045, new-002 |
| Myth / contrarian | "Most people think ___. It doesn't." / "People say you can't ___." | vid_m029, supplied-025, new-005, new-006, new-049 |
| Proof first | "I'm 22 and just sold this home for over $3M." / "My buyer paid 45k under asking…" / "Went under contract in five days…" | vid_m032, vid_m061, new-001, new-012, new-013 |
| Curious question | "Have you ever seen a home with a bridge on the roof?" / "What if you could see your future home before it was built?" | supplied-028, new-025, vid_m009, new-023 |
| Price contrast | "Why spend $2M in ___ when you can buy this for $450K in ___?" | vid_m031, vid_m018 |
| Warning / one question | "Do not ___. Do this instead." / "Before you hire ___, ask yourself this one question." | vid_m023, vid_m012, vid_m019 |
| "This is what you can get" | "This is what you can get for $___ / in ___ / on two acres…" | new-029, new-031, new-035, new-037, new-045 |
| Skit or interruption | Phone call ("Oh, sorry, one second"), golf swing, "Hold on.", "Congratulations!", cowgirl hat, "The video's too fast!" | vid_m014, supplied-019, new-028, new-010, new-018, vid_m036, vid_m004 |
| Brand promise line | "We don't just list your home, we launch it." / "Some homes are built to be lived in." | vid_m002, supplied-036, supplied-038 |
| Feature tease | "Before I share this location, let me show you my favorite features." / "Out of every room… this is the one I can't stop thinking about." / "No, I'm not AI, but…" | vid_m028, new-004, new-011, new-014 |
| Lifestyle "what if" | "What if this… and this… minutes from your front door?" | supplied-007 (Wilmore) |
| Show, don't tell | "I can tell you my videos work all day, or I can show you in under 10 seconds." | supplied-002 |
| Prestige place | "This is ___, ___'s most private luxury enclave." | new-024, new-008, new-050 |
| Meme line | "Ladies, if your man can't afford this home…" | vid_m164, supplied-004 |

**Body structure**
- Talking head (WT/SI/PC/SH): hook → the problem or insight → proof (number, result, screenshot) → reframe ("the difference between putting a home on the market and marketing a home") → CTA. That is 4–7 beats, with one keyword visual each.
- Tour (HT/POV): hook → location and lifestyle (minutes to X) → one feature per room → value or "smart investment" line → comment-word CTA. Specs (beds, baths, sq ft) are said once, late, as a single line.
- Vision pitch: "if this were mine" → what it is now → what it could be (named concepts) → the question to viewers.

**Endings (55 of the 109 spoken reels end on an explicit ask)**
- Call / contact: "give me a call", "my number's right here" plus a contact card (about 23).
- Soft: "let's talk", "let's connect", "reach out" (about 13).
- **Comment-word** (12+; Whisper often mishears it as "Common…"): `Comment MOORESVILLE / SWING / FARMHOUSE / ROOFTOP / NEWTON / CHARLESTON / MIAMI`, which is the Kelsie tour standard; it names the place or the hook.
- **DM-word** (11+): `DM me VIDEO / PLAN / MEDIA / STANDARDS`, the B2B videographer standard.
- Link in bio / below (about 7); question to viewers (Melissa); "Save this for later" (Kelsie listicle).
- Reese's POV template: "If you're interested in this home or something similar, I would love to help. DM me for more."
- Brand, podcast and story reels often end on the punchline or a quote with no ask. Use this only when the goal is reach, not leads.

## 6. Sound

- Speech-led reels: voice on top, a low music bed under it (trending or instrumental), SFX on graphic reveals only (pop on a word, whoosh on a whip, riser into a reveal). Keep SFX 8–15 dB under the voice, as in the MotionSmith rule.
- Tours and films: one continuous music bed cut on the beat; ambient room tone or a short host line over the top.
- Montage reels: one song, cut to the beat, with a fixed quote caption.
- Deliver at about −14 LUFS integrated with true peak at or below −1 dBTP. Every reference measured −14.0 to −14.7 LUFS after Instagram's processing.

## 7. Recipes (defaults; the brief overrides)

**WT — walk-and-talk kinetic (30–45 s)**
1. Hook sentence in the first 1.5 s while walking toward camera; the first emphasis word pops at about 0.3 s.
2. One beat per sentence: a running caption plus one big keyword behind the subject (matte) in the accent colour; alternate white and accent.
3. Every 2–3 beats add one device: floating card, icon, map or number hero, each tied to the spoken word.
4. Change location or angle every 4–8 s, with a whip or blur on the cut; never more than about 3 s without a new visual event.
5. Close on a contact card or `DM me <WORD>` / `Comment <WORD>` and a logo, held for 1.5–2 s.

**SI — polished interior talking head (30–60 s)**
1. Seated or standing in a styled room; two framings, cutting on sentence boundaries; slow push-in on the key line.
2. Serif-italic plus sans keyword pairs, pills and notification cards beside the head; proof screenshots as PiP.
3. Optional cutaways to b-roll of what is being described (listings, team, website).
4. End on the save/contact CTA, with paid partnership fine print if sponsored.

**PC — podcast clip (20–60 s)**
1. Start mid-sentence on the strongest line; no intro.
2. Word-level captions in white with magenta/accent pops on emphasis words, at the mic or chest line; occasional huge stat word in 3D.
3. Cut between host and guest angles; letterbox for a "show" feel; brand watermark top-left.

**HT — hosted listing tour (45–75 s)**
1. Lifestyle or skit hook (Wilmore "and this?", golf cart, cowgirl hat) or a price/address hook, in 2–4 s.
2. Aerial establishing shot with a neighbourhood or town label, then an FPV/gimbal push from the exterior into the interior (one unbroken move if possible).
3. Room by room, 1–3 s per shot, **one selling point per room** as a small label (`Foyer`, `Hardwood`, `Soaring ceilings`).
4. Host interjections to camera between rooms (porch, kitchen island); top-down drone and a detail macro for rhythm.
5. Optional wow beat: AI transformation morph or staged/unstaged match-cut.
6. Seated close with the value line plus a comment-word CTA; logo card.

**CF — cinematic listing film (30–90 s)**
1. Letterbox, a moody grade, one music bed, no captions or only an address/price card.
2. Open on a blue-hour exterior, light beams or an FPV approach; title card (`ADDRESS / BROKERAGE`).
3. 1–2 s shots on the beat: aerial, FPV, interiors, details, lifestyle (boat, dining); one price card.
4. End on a logo over an aerial or on black.

**POV — influencer walkthrough (10–75 s)**
1. Header text at the top in the first frame: `POV: you found your dream home` / `Located in <City>, TX` / `Starting from $___ · FOR SALE NOW` (bold italic, emoji pin).
2. Agent walks the viewer through the rooms on a handheld gimbal, gesturing; small captions or single bold uppercase words low in frame (`BOOKMARKED`, `TUB`).
3. Skit or meme hook variants ("getting robbed but I'm walking by a beautiful house"); poll variants ("Which home are you choosing? 1 / 2 / 3").

**VP — vision pitch (20–30 s)**: Melissa recipe in the mega prompt. For a static template version, use before/after phone frames (aerial → render) with measurement labels and a comment-word CTA (supplied-003).

**LIST — listicle (30–45 s)**: Kelsie listicle in the mega prompt (visible countdown ring, numbered badges, one keyword per tip, save plus contact CTA, full list in the caption). An alternative look (vid_m023) uses grid-paper "step" cards with icons and huge yellow percentages.

**MONT — montage (7–30 s)**: 10–30 beat-cut lifestyle/BTS shots, one fixed quote caption (small, centred, top third) or a two-line call-and-response (`They ask who are you trying to impress` → `Him`).

## 8. Edit checklist (run before handing back)

- Hook spoken or shown inside 1.5 s; first visual change inside 1 s.
- Every spoken idea has a visual; no plain stretch longer than about 3 s.
- One emphasis word per beat; at most two colours plus white; font pair consistent all video.
- The face is never covered; text sits behind the person or in negative space; key text is out of the Instagram UI zones (top 14%, bottom 20%, right 15%).
- Transitions are motivated by movement; one wow beat at most.
- Numbers, names and claims are the user's own and verified; nothing is copied from a reference creator.
- Ends on one specific CTA (comment word / DM word / contact card / logo).
- 1080×1920, 30 fps, about −14 LUFS, H.264; preview frames checked at the hook, the middle and the end.

## 9. Creator signatures in the set

- **Kelsie Blevins (`_k.elsie`, 44 reels)** has four looks: (a) hosted tours with FPV/aerials, serif-italic room labels and a seated close; (b) polished interior talking heads with serif + sans keywords, pills, notification cards and Homes.com proof screenshots; (c) podcast clips with magenta pops; (d) car selfies with small serif captions. Brand-story and team-launch reels use light leaks and huge words (`IS HERE`). Keep this distinct from the `@kelssie3` six-video teardown (see [kelssie3.md](kelssie3.md)).
- **Josh Cohen / Listwell (`joshiscohen`, 24 reels)**: a videographer brand with three looks. Walk-and-talk sales pitches to agents use chunky multi-colour words behind the subject (`$100M`, `In South Florida`). Luxury listing films are letterboxed, with title cards and price cards. Short lifestyle montages carry one quote line. Also a car-detailing promo (non-real-estate) in the same WT look.
- **Reese Kiselak (`reesekiselakrealtor`, 19 reels)**: Texas new-construction POV walkthroughs. A location/price header, the agent walking and gesturing through rooms, small captions, skit and poll hooks, plus a "building a house" series (`part 19 of building`).
- **GP Multimedia (`gp__multimedia`, 3)**: walk-and-talk with two-tone words behind the subject, floating cards/logos, a state map, a `DM me VIDEO` CTA and a phone-number card.
- **Melissa Orta (3)**: Spanish and English; seated or roadside to camera, aerial site, price-grid collage, MO/Marzucco logo end card.
- **Barsol Media (3)**: highly designed editorial (red/black collage, curved and arc text, scattered photos, flags) plus two-agent skits with oversized words (`PRIVACY`, `AUTOCORRECT`).
- **OBX Island Guys (2)**: walk-and-talk with huge multi-colour words, a flag-filled state name, a photo collage and a glitch logo outro.
- One-offs worth reusing: the Shooter/Shot reveal (bluesprucemedia), the speed-ramp transition tutorial (pires.visuals), the AI "house appears behind you" workflow (pires.visuals vid_m020), the Captions-app template look (madebyprabhat), the price lower-third over unit renders (invistacompriscila), animated location maps (l17.marketing), and Hormozi-style yellow/green word captions under a headline box (sabeel.shopify).

## 10. How to apply to the user's footage

1. Transcribe (`captions-skill/scripts/words.py`, or `tools/study_reels.py`'s ffmpeg-decode approach if PyAV errors) and split into beats.
2. Pick the archetype (§2) and recipe (§7); if the user names a style, use its playbook instead and borrow devices from §4.
3. Storyboard every beat (keyword, device, shot, transition, SFX) and show it before rendering, per the mega-prompt workflow.
4. Build with the available tools: Remotion (installed skill) for kinetic type, cards and maps; the `effects` skill for face-tracked and behind-head effects (orbit, spotlight, glass widgets, headline wall, iMessage pop-ups); the captions skill for word-timed captions; ffmpeg to assemble, grade, loudness-normalise and export. After Effects routes only via a connected AE MCP (see the mega prompt, style 11).
5. Run §8, render 9:16, and report the archetype, the beat list and the tools used.

## Appendix — per-reel catalogue

Type codes: WT walk-and-talk · SI interior talking head · PC podcast · HT hosted tour · CF cinematic film · POV walkthrough · VP vision pitch · LIST listicle · MONT montage · SH selfie · BTS behind-the-scenes · DEMO product demo. "Hook" is what is spoken in the first ~4 s (— = music-only or no confident speech).

| Reel | Creator | Type | s | Cuts/10s | Hook (first ~4 s spoken) | What to take from it |
|---|---|---|---|---|---|---|
| [vid_m001](https://www.instagram.com/reel/Df2FOWBhCrR) | gp__multimedia | WT | 34 | 1.19 | Minnesota Realtors, if you're paying for professional video, shouldn't you be getting best | Walk downtown; two-tone kinetic words (white + orange/cyan) behind subject; floating profile cards; line-art eye icon; contact card with phone number at end |
| [vid_m002](https://www.instagram.com/reel/Df0CJt9SN8Y) | squarefoothomes | WT | 38 | 0.27 | We don't just list your home, we launch it. Selling for top dollar starts long | Standing in a sunny street; words placed behind subject (depth matte); Instagram-logo icon; red strike-through on 'old school yard signs'; 'really launching your home' two-colour |
| [vid_m003](https://www.instagram.com/reel/DfpMAuHuAi7) | melissaortarealtor | SI | 30 | 2.02 | Si estás buscando casas en Lehigh y no has visto las que tengo, te estás pidiendo las mejo | Spanish; seated in a modern living room; price-point photo grid ($260k-$300k); interior b-roll per room; MO / Marzucco logo end card |
| [vid_m004](https://www.instagram.com/reel/DfaHdixTWUY) | barsolmedia | WT | 38 | 5.48 | If you ever dreamed of living like a billionaire, this house is for | 'If you ever DREAMED' behind subject; green vertical-stripe graphic wipe; 3D '2023'; handwritten script over interiors; drone estate close |
| [vid_m006](https://www.instagram.com/reel/DfS3bYHBzQf) | cliffsidecuts | HT | 52 | 5.16 | In 2026, the homes that stood out in Las Vegas had something money | Las Vegas modern estate; FPV drone through rooms; small serif captions; host standing gesture; gym/detail inserts |
| [vid_m007](https://www.instagram.com/reel/DfS19jhuUWr) | michaelaziz.vs | HT | 44 | 3.82 | Here we are, here | 'Here we are' + address '2603 Drive' big type behind walking host; night pool; top-down drone; interiors; 'This new build' on deck |
| [vid_m009](https://www.instagram.com/reel/DfCVmowg8jy) | courtneywalshbaisa | WT | 34 | 0.3 | What if your advisor set the investment criteria and my team handled everything after | Two-agent collab; cluster of floating 3D icons; script + serif mixes ('wealth management'); end card name/contact on white |
| [vid_m011](https://www.instagram.com/reel/De2LWQwomXm) | pires.visuals | BTS | 43 | 0.69 | First, | 'You need to learn this transition' serif hook; Take 1 / Take 2 split; Final Cut timeline + face cam; speed-ramp payoff |
| [vid_m012](https://www.instagram.com/reel/DerRQWgo8yn) | caitlinoconnorrealestate | WT | 16 | 1.86 | Before you hire a listing agent, ask yourself this one question. Do I trust this | 16s; big serif words behind subject; line-drawn house icon with sparkles; waterfront boardwalk walk |
| [vid_m014](https://www.instagram.com/reel/DeZLJV0K-_-) | yourrealtorinfloridaa | HT | 42 | 5.24 | Oh, sorry, one second. Hello? Yeah, I'm about to tell them right now. | Black-and-white phone-call opener; letter-spaced kinetic words ('5 bed', '2 brothers'); interiors; aerial close |
| [vid_m015](https://www.instagram.com/reel/DeOPjoFR-a7) | joshiscohen | WT | 22 | 0.92 | You didn't get into real estate to be a content creator. You got in there to sell homes. | Videographer pitching agents; 3D words behind; stacked tags 'Scripting / Filming / Editing'; multi-colour kinetic words |
| [vid_m017](https://www.instagram.com/reel/Dd76h-2RpSv) | joshiscohen | WT | 41 | 0.98 | If you're in real estate media doing over 10k a month and the whole thing stops the second | '$10,000 a month' money hook; colourful word-level kinetic text behind subject while walking |
| [vid_m018](https://www.instagram.com/reel/Dd1DbV6uyGF) | antonellacariboni | HT | 89 | 2.59 | Se você tiver 100 mil e o seu marido tiver 14 ,9 milhões, essa casa | Portuguese; price headline R$14.900.000; serif-italic labels ('Vista Permanente', 'Recem Construida'); modern house tour; 89s |
| [vid_m019](https://www.instagram.com/reel/Ddkl1qDIlCH) | caitlinoconnorrealestate | WT | 20 | 2.04 | The first showing of your house happens online. Before anyone steps foot in your home, | Serif-italic words; whip-blur transition; 'MOST important decisions' heavy italic |
| [vid_m020](https://www.instagram.com/reel/DdHYthaIq_9) | pires.visuals | BTS | 48 | 0.21 | How to make a house appear behind you in 30 seconds. Start | Higgsfield/Kling AI workflow screen recording; 'appear behind you' effect tutorial; laptop mock-ups |
| [vid_m021](https://www.instagram.com/reel/DdGs8HcRd6j) | _k.elsie | HT | 71 | 4.49 | Every neighborhood has a lot that's better than the rest and this is it and it's five minu | 71s Kelsie tour: host intro, sunburst exterior, rooms, top-down drone, close seated on sofa |
| [vid_m022](https://www.instagram.com/reel/DdCn6koh6es) | bluesprucemedia | BTS | 14 | 8.38 | — | 'The Shooter' / 'The Shot' pairs: operator with gimbal then the resulting shot; 14s, very fast cuts |
| [vid_m023](https://www.instagram.com/reel/DcvtZegCKr_) | javierfiguerroa | LIST | 49 | 3.67 | Do not buy your first home with your boyfriend or girlfriend. Do this instead. | 'Step #1 / #3' badges; grid-paper numbered list with icons; 'as little as 3% down' yellow numbers; house model prop; IG follow icon |
| [vid_m024](https://www.instagram.com/reel/Dcs_d-LRaRK) | renataostasrealtor | WT | 48 | 0.42 | There's a huge difference between being ready to buy a house and actually being | Walk then sit; small lowercase captions + big keyword behind; broken-heart icon; 'pre-approval' |
| [vid_m026](https://www.instagram.com/reel/DcghbiIRccM) | invistacompriscila | HT | 15 | 5.43 | — | Portuguese; 'HEY / STOP' big 3D letters; walking with laptop; street sign; development logo; unit renders with persistent price lower-third; 'Quer investir? Me chama agora' |
| [vid_m027](https://www.instagram.com/reel/DaxRn6Nykxi) | l17.marketing | HT | 58 | 3.46 | Most still -collects you need are over 1 .5 million But this | Malaysia condo; 'OVER 1.5m' red numbers; 'FREEHOLD', '4 bathrooms', '50m Olympic-length pool'; animated location map with glowing roads; 'Duplex' |
| [vid_m028](https://www.instagram.com/reel/DaNYpI2xw1M) | _k.elsie | HT | 62 | 3.24 | Before I share this location, let me show you my favorite features of this single -level | 'my favorite features'; walk-through; town aerial labelled 'Statesville'; rooms |
| [vid_m029](https://www.instagram.com/reel/DZXzWSPuqqj) | jonidahaliliyyc | WT | 41 | 1.23 | Most people think luxury means a high price tag, it doesn't. Every | Pink script 'Luxury' + serif; glass-pill UI; 'The price tag'; phone b-roll; glass contact card with number |
| [vid_m030](https://www.instagram.com/reel/DZDQ1NAPoY4) | wolfeofrealestate | WT | 14 | 0.73 | People often ask me, Erica, do you get upset when people use other | 14s static wide by a for-sale sign; bold uppercase white captions centred low; almost no cuts |
| [vid_m031](https://www.instagram.com/reel/Dfzlf6PudPi) | melissaortarealtor | HT | 57 | 4.7 | Why spend $2 million in Miami when you can buy this phone for $450 ,000 and | Melissa: 'for under $500K' exterior walk; 'cabinets' labels; whip-blur; logo end card |
| [vid_m032](https://www.instagram.com/reel/DeZOgPZxrlq) | reesekiselakrealtor | SI | 62 | 1.45 | I'm 22 years old and just sold this home for over $3 million. It had previously been on | Standing in a modern home; small captions + gradient script keywords ('marketing strategies', 'my clients') |
| [vid_m033](https://www.instagram.com/reel/DdkOWmphatA) | joshiscohen | WT | 27 | 1.51 | You know that agent in your market that sells way more than you? They're not actually bett | 'You know that agent in your market' yellow/red/white; strike-through 'actually'; big two-tone words behind |
| [vid_m034](https://www.instagram.com/reel/DcI2sUKxktO) | _k.elsie | WT | 37 | 3.0 | It's no secret clients come to me to get the job done. So far in 2026 | Bench + bridge walk; floating photo collage '50 HOMES'; 'Pricing' pill; phone-call b-roll; 'negotiation skills' |
| [vid_m035](https://www.instagram.com/reel/DafU-rnRiEx) | _k.elsie | SI | 48 | 0.84 | I never recommend anything to my clients or other agents that I haven't tested on my own | Red jumpsuit in luxury home; Homes.com logo + paid-partnership fine print; orange light-trail ring; yellow scribble line; PiP of listings |
| [vid_m036](https://www.instagram.com/reel/DaDc23rRD3A) | claudiorivera.910 | WT | 48 | 2.28 | Oh, the video's too fast! We can't even see the house! | 'Ooooh! too fast' 3D text; 'but can they sell houses?'; '$12m Sale' yellow; seated veteran-agent interview; 'Comment' CTA; night pool |
| [vid_m061](https://www.instagram.com/reel/DZWLhE3uEhO) | raelynn_wetzel_hibbert | SI | 32 | 2.17 | My buyer paid 45k under asking and moved in with 75k in instant | 'buyer' big yellow; '75k' numbers; 'deal'; calendar icon; orange glow; 'single dollar' |
| [vid_m122](https://www.instagram.com/reel/DeT-EekJfWe) | madebyprabhat | DEMO | 14 | 4.27 | — | Captions-app demo: template grid, keyword style presets on agent footage |
| [vid_m139](https://www.instagram.com/reel/DcvVp-Qof2x) | arsacre5 | DEMO | 26 | 2.28 | — | Landscape 16:9 3D motion-graphics product promo (pink UI scenes, 'Publish'); not a realtor reel |
| [vid_m160](https://www.instagram.com/reel/DeOkA2WDCQ0) | aaun.ceo | BTS | 34 | 1.19 | — | 'Background music for real estate' series: album covers list, 'comment MUSIC' CTA, 'DAY 11' badge, face cam |
| [vid_m164](https://www.instagram.com/reel/DcebGmDhJbj) | joseoliveirafilms | SH | 60 | 0.0 | Ladies, if your man can't afford this home, you need a new man. This one | Seated dark moody interview; early PiP vertical clips; small lowercase captions; 60s single take |
| [vid_m165](https://www.instagram.com/reel/DaLdv8hx87v) | claudiorivera.910 | WT | 31 | 0.0 | If you're a videographer, stop scrolling. If you're on Instagram, you've seen her | 'STOP SCROLLING' red/blue; two-person collab; 'Focus on a client' multi-colour kinetic; 'if you want to learn' |
| [supplied-001](https://www.instagram.com/reel/DaKnrcQxQ_u/) | gp__multimedia | WT | 32 | 0.93 | The best brands in real estate aren't waiting to be found. They're creating a tension in | Pool-house walk; floating brand-logo circles; Minnesota map highlight in blue; 3D 'HOME FOR SALE' sign; orbiting photo cards; 'STAND OUT online'; 'DM me VIDEO' |
| [supplied-002](https://www.instagram.com/reel/DdHguJfhYSU/) | gp__multimedia | WT | 27 | 3.0 | I can tell you my videos work all day, or I can show you in less than 10 seconds. | Sunset boardwalk 'WORK' behind; '10 SECONDS' orange; popping hearts/likes; 'young entrepreneur'; white flash; 'ATTENTION' cyan; 'DM ME' + phone |
| [supplied-003](https://www.instagram.com/reel/DZS2tsUB2eL/) | ahmedalghailii | VP | 26 | 0.0 | Located at 4821 Commerce | Static template: Before / After phone frames: aerial site -> 3D renders with measurement labels (33FT, -7.5, numbered pins); comment 'file' CTA |
| [supplied-004](https://www.instagram.com/reel/DeTf6qEBDxp/) | dazzzlme | BTS | 19 | 2.67 | — | Meme reaction hook 'never hire a real estate video editor again'; phone editing-app timeline screenshots showing kinetic templates |
| [supplied-005](https://www.instagram.com/reel/DdrG_fPI4nh/) | Quentin | SH | 53 | 1.13 | If you're a 17 year old smart kid, you can literally call every local business and be like | Borrowed-clip hook + satisfying pressure-wash split; desk face cam with screen-recorded AI tool tutorial; small captions |
| [supplied-006](https://www.instagram.com/reel/DewTzCzxR9q/) | _k.elsie | LIST | 35 | 1.7 | I'm a top listing agent in North Carolina and hear some things you need to know when you'r | THE 30-second listicle: seated sofa, laptop countdown ring 00:30 -> 00:01, notification cards, pills 'Marketing Plan' / 'Strategy', serif-italic purple keywords |
| [supplied-007](https://www.instagram.com/reel/DfzaFE1xv02/) | _k.elsie | HT | 54 | 4.47 | what if this and this and this minutes from your front | Wilmore tour: 'and this?' lifestyle walk with coffee, porch piece-to-camera, 'If location' serif seated, FPV over lawn, rooms, skyline aerial |
| [supplied-008](https://www.instagram.com/reel/DfkBM9XuE_L/) | melissaortarealtor | VP | 27 | 2.19 | If this was my property, I'd knock it down and build a place where people can actually han | Melissa vision pitch: 'I'd knock it' roadside, aerial of vacant lots, 'in Lehigh', arms-open 'Look at all this space', logo |
| [supplied-009](https://www.instagram.com/reel/DXeU5dDkeXe/) | _k.elsie | HT | 61 | 3.62 | If you love the finishes on this property, then | Book/sign card graphic 'property'; driveway FPV; rooms; host in kitchen with notification card |
| [supplied-010](https://www.instagram.com/reel/DFfqG4Bokiv/) | chekd.talks | PC | 78 | 2.7 | we don't do cold calls zero yeah zero cold calls i don't promote | Two-guest podcast; small bold uppercase captions centred; show watermark; 78s |
| [supplied-011](https://www.instagram.com/reel/DeMX3SFoqmn/) | sathya.porsche | HT | 104 | 0.38 | — | First-person 'take my hand' POV tour of a luxury villa with host; sparse stat text '6.25% 3 MONTHS'; 104s |
| [supplied-012](https://www.instagram.com/reel/DX8IOu1jMso/) | sabeel.shopify | SH | 33 | 0.0 | Recently, when I did business in your estate, | Seated interview; white headline box on top ('4 Months: $4M Invested...'); yellow/green word-level bold captions at bottom |
| [supplied-013](https://www.instagram.com/reel/DVOXBwMDuZI/) | moshewigder | SH | 78 | 0.0 | I'm getting gas all the time. I'm Muslim. I followed the | Selfie talking head; small white captions mid-low; 78s single take |
| [supplied-014](https://www.instagram.com/p/DQLgbzOgOVo/) | playhousehunt | DEMO | 27 | 1.84 | — | Hands holding phones demoing a house-price game app; meme hook caption |
| [supplied-015](https://www.instagram.com/reel/Df4i9u2RRnq/) | _k.elsie | PC | 25 | 0.0 | The agents who are gonna make it in 2027 are the ones that are most available, | Podcast mic; magenta + white mixed caps words; 'MOST urgency'; squiggle doodle |
| [supplied-016](https://www.instagram.com/reel/Dfmcq18xp80/) | _k.elsie | PC | 26 | 2.3 | If you're not being cringe, you're not doing it right. You need to be cringe. | Podcast with skit b-roll cutaways (videographer); glitchy magenta 'Let them!' |
| [supplied-017](https://www.instagram.com/reel/Dffr52cpB9G/) | _k.elsie | SH | 85 | 0.0 | okay with the approval of man until I realized hello happy Sunday I have | Car selfie; small serif white captions; dog cameo ending; 85s single take |
| [supplied-018](https://www.instagram.com/reel/DfZrBH4xlrF/) | _k.elsie | PC | 18 | 0.0 | And listen to this, most people, most people do give up. | 'listen to this' magenta; huge 3D pink '1%'; 'doesn't give up' |
| [supplied-019](https://www.instagram.com/reel/DfXHdL5R-qi/) | _k.elsie | HT | 65 | 5.58 | Let's see if my swing's gotten any better. | Golf-swing opener; autumn aerials; rooms; moody gym lighting; closes standing with a quote |
| [supplied-020](https://www.instagram.com/reel/DfPXEWSxcqE/) | _k.elsie | MONT | 7 | 24.38 | — | 7s, 18-cut BTS montage; quote overlay 'aren't you afraid things won't work out?' -> 'no' |
| [supplied-021](https://www.instagram.com/reel/DfHj27sRdQu/) | _k.elsie | SI | 71 | 2.67 | Don't know something crazy. What weren't you out like 50 ,000 followers | Team/brand story: 'Ya'll know something crazy', 'LET'S TALK ABOUT IT.' serif, neon-pink ring, '260,000' pill, team members walking |
| [supplied-022](https://www.instagram.com/reel/DfCbaSYR-xf/) | _k.elsie | HT | 71 | 5.52 | When a luxury farmhouse sits the market and checks every single box, you can't help but wo | 'you can't help but wonder' serif-italic; dramatic low-angle exterior; rooms; host standing |
| [supplied-023](https://www.instagram.com/reel/De_1LDLxTc1/) | _k.elsie | CF | 166 | 6.21 | Inside Blue Ridge | 166s letterboxed mountain-home film; 'that feels a world away' serif; 103 cuts |
| [supplied-024](https://www.instagram.com/reel/DerKqWrRZyo/) | _k.elsie | SI | 73 | 2.47 | If you're looking to become a successful real estate agent in 2027, you need to start givi | Variant of supplied-021 team/recruiting story; pill chat bubbles; 'the goal' |
| [supplied-025](https://www.instagram.com/reel/Deg3CWyRy4C/) | _k.elsie | SI | 46 | 2.16 | People say you can't sell real estate from social media. I've sold several solely from Ins | 'You can't sell' serif + pink; huge pink 3D '74%' / '73%'; 'Exposure' pill; 'But here's the thing' serif |
| [supplied-026](https://www.instagram.com/reel/DeRrQyexyRK/) | _k.elsie | PC | 117 | 2.82 | So I had to sell like four or five houses just to get the funds to pay my rent or | Guest-podcast cut, letterboxed; 'From Basement To Brand' label; town aerial; big serif 'closed'; website screenshots; 'CONVERSATION' card |
| [supplied-027](https://www.instagram.com/reel/DeO53P0x3T7/) | _k.elsie | PC | 25 | 0.4 | One thing I do want to say is I want the person watching this to show up so unapologetical | 'ONE thing' / 'I'd wanna say is' magenta; 'learning consistent' |
| [supplied-028](https://www.instagram.com/reel/DeMMoMrRBD3/) | _k.elsie | HT | 80 | 6.49 | Have | Golden-hour film; big 3D white 'one'; FPV; night exterior; wine wall; rooms; seated close |
| [supplied-029](https://www.instagram.com/reel/Dd_UhQqRDXD/) | _k.elsie | SI | 28 | 8.08 | I started making content because I wanted to stand out better than my | Seated chair; 'started making content' magenta; huge 'SOLELY'; cut to lifestyle b-roll (car, red dress, paper) |
| [supplied-030](https://www.instagram.com/reel/DdzLN9ORDFH/) | _k.elsie | SH | 57 | 0.18 | Hello happy Sunday. Happy because I'm going to show the house but I just left service and | Car selfie; tiny uppercase captions; props (book, magazine); faith story |
| [supplied-031](https://www.instagram.com/reel/DdrDF4ExELI/) | _k.elsie | PC | 116 | 0.77 | I swear, I heard Jesus say, thank you and I'll watch what I can do with your life. | Letterboxed podcast with guest; kinetic words left ('&broke', 'faith') |
| [supplied-032](https://www.instagram.com/reel/DdoJNXPRnjD/) | _k.elsie | HT | 56 | 4.25 | You love the finishes on this property, so we | 'THE FINISHES' pink serif; aerials; 'Downtown Newton' pink; zoom-blur transitions |
| [supplied-033](https://www.instagram.com/reel/DdYtEPeBua6/) | _k.elsie | MONT | 49 | 3.87 | Guys, this trip has been so much fun, but I just can't get that song out of my head. | Letterboxed team trip montage (boat, rooftop); no on-screen text |
| [supplied-034](https://www.instagram.com/reel/DcyXP41uK_b/) | _k.elsie | MONT | 36 | 3.38 | We | Launch announcement: team walking; 'IS HERE' huge; 'EVERYTHING we've learned'; '16th SEPTEMBER' magenta; light-leak transitions |
| [supplied-035](https://www.instagram.com/reel/DOZVxThj3Ur/) | _k.elsie | CF | 39 | 6.14 | — | No host; aerial, FPV, rooms; builder logo end card 'NORTHWAY signature series' |
| [supplied-036](https://www.instagram.com/reel/Df5BXyIuU3S/) | joshiscohen | CF | 80 | 6.47 | Some homes are built to be lived in. This one was built to be remembered. | Letterboxed luxury film; small host; aerials; city |
| [supplied-037](https://www.instagram.com/reel/Dfp9X7LpnVU/) | joshiscohen | CF | 72 | 8.2 | — | Letterboxed historic estate, fine-dining details, couple; 59 cuts |
| [supplied-038](https://www.instagram.com/reel/DfaTSb1MhzT/) | joshiscohen | HT | 63 | 1.9 | This thing is going to stand forever. It better. Why's that? | Two developers in suits; warm retro 'It better'; FPV over construction; serif 'downtown,' 'finishes.'; 'LATITUDE KEY' title on aerial |
| [supplied-039](https://www.instagram.com/reel/DfIO_idNW62/) | joshiscohen | CF | 34 | 0.0 | — | Letterboxed: operator at dusk 'getting the shots', then '$23,950,000' price above shots + address line |
| [supplied-040](https://www.instagram.com/reel/DehH3_Hk0YZ/) | joshiscohen | HT | 66 | 7.78 | People choose to live in New York City for | NYC penthouse with female host; small words 'live', 'penthouse'; night skyline; logo end |
| [supplied-041](https://www.instagram.com/reel/DeUzN3SIsP_/) | joshiscohen | SH | 24 | 0.0 | You can't build a brand from a one -time video, so if you shoot agents and you sell them o | Selfie; 'STOP SELLING ONE VIDEO!' caps at top; small captions; finger gesture |
| [supplied-042](https://www.instagram.com/reel/DePL5EQJLPY/) | joshiscohen | MONT | 45 | 7.16 | All right, man, show me what you got. When | Sunset, tux film-reference, 'This is what they Meant' bold; 'Look at this' serif; boxing; white flash; LISTWELL logo |
| [supplied-043](https://www.instagram.com/reel/DeKOguKRKSN/) | joshiscohen | WT | 72 | 3.9 | If you drive a nice car and book or tone, you're probably tired of your car looking | Non-RE car-detailing promo: 'YOU'RE PROBABLY... CAR' red/white caps; 'LOCALS', 'FLORIDA,' white caps; logo end |
| [supplied-044](https://www.instagram.com/reel/DUNAKWAjXbu/) | joshiscohen | MONT | 10 | 0.0 | — | 10s static beach shot with a quote text block at top; no cuts |
| [supplied-045](https://www.instagram.com/reel/DdxPvHxvlJ4/) | joshiscohen | WT | 23 | 0.87 | If you're a real estate agent you already know you should be posting, but that's not the p | 'If you're a real estate agent' yellow + white; 'but that's not the problem' green; 'knowing how to film it' |
| [supplied-046](https://www.instagram.com/reel/DdwhL0rxL48/) | joshiscohen | MONT | 23 | 3.42 | — | Tactical-car shoot skit; dialogue captions |
| [supplied-047](https://www.instagram.com/reel/DUNBuVzDdKE/) | joshiscohen | MONT | 11 | 0.88 | — | Letterboxed: 'They ask who are you trying to impress' -> 'Him'; drone over a lone figure |
| [supplied-048](https://www.instagram.com/reel/DdijKiStIRo/) | joshiscohen | MONT | 10 | 13.53 | — | 10s BTS montage with fixed quote 'the day you plant the tree is not the day you eat the fruit' |
| [supplied-049](https://www.instagram.com/reel/DdhtGPIoJgG/) | joshiscohen | MONT | 11 | 16.72 | — | 11s lifestyle montage with fixed quote 'You don't get burnt out? Nah my life is sick' |
| [supplied-050](https://www.instagram.com/reel/Ddg-2hOxDCd/) | joshiscohen | MONT | 24 | 12.35 | — | Letterboxed travel/lifestyle montage; 30 cuts |
| [new-001](https://www.instagram.com/reel/DS4xZdwkd9Z/) | _k.elsie | SI | 78 | 4.08 | I am 24 years old. I became a licensed realtor in April of | Story/testimonial: headshot open; 'FIRST' huge; 'change' script; sunglasses 'The 1%'; photo collage of results |
| [new-002](https://www.instagram.com/reel/DdcobPXoVMY/) | joshiscohen | WT | 26 | 1.16 | If you're a real estate agent in South Florida and you're selling million -dollar properti | 'In South Florida' yellow; '$100M' blue; globe map 'across the nation'; LISTWELL logo; 'first agent that sellers' yellow |
| [new-003](https://www.instagram.com/reel/DdMP35yxIv_/) | joshiscohen | MONT | 42 | 5.73 | We all know that I'm a Long Islander through and through, but I traded the South Shore | Voice-over lifestyle montage (dog, boat, train) with small italic serif captions; 24 cuts |
| [new-004](https://www.instagram.com/reel/DdjFK5HxbGX/) | _k.elsie | HT | 68 | 6.17 | Before I share this location, let me show you this property's best features. | 'Best Features' serif-italic green; 'Foyer' big; room labels; aerial road; standing close |
| [new-005](https://www.instagram.com/reel/Dc_es39AeAE/) | obxislandguy | WT | 35 | 1.41 | Some agents will tell you they know North Carolina real estate, but I only know one part o | 'NORTH CAROLINA' flag-filled letters; 'BETTER' yellow; 'Real Estate' blue; photo collage; glitch logo outro |
| [new-006](https://www.instagram.com/reel/Dc_VI4PAT3A/) | matt_baldwin_realtor | WT | 41 | 0.97 | So people have been asking me lately if all | Big words behind subject; huge '6.5 years ago'; 'High level of service'; black-and-white ending |
| [new-007](https://www.instagram.com/reel/DL951yeg6x2/) | joshiscohen | HT | 69 | 3.64 | Topic, you gotta back it up. One shot, one block, | Commercial property: 'One block' two-tone; office; aerial; '61 PARKING SPOTS' number on top-down; mural; motion blur |
| [new-008](https://www.instagram.com/reel/Dc3ptdNuQrr/) | outerbanksagent | CF | 63 | 5.52 | Pine Island is one of the most exclusive structures of beach on the Outer Bank. | Beach aerials; FPV; rooms; small text; 'SERHANT.' logo over aerial |
| [new-009](https://www.instagram.com/reel/Dcs7yySRlnZ/) | _k.elsie | SI | 44 | 1.82 | Let me be the first to say your property deserves the investment from your real | 'YOUR PROPERTY deserves the' serif; seated in several rooms; glass icon; Homes.com |
| [new-010](https://www.instagram.com/reel/Dca6EWTxGpw/) | _k.elsie | HT | 69 | 5.06 | Congratulations! You're moving to the next level. Your next opponent is... | 'your next OPPONENT IS' serif; golf-course aerials; rooms; standing close |
| [new-011](https://www.instagram.com/reel/DcOJ1b1RcGR/) | _k.elsie | HT | 54 | 8.58 | Out of every room in this 8 million Lake Normandus day, this is the one I | '$8 Million Lake Norman estate' serif; gold fixtures; pool; island aerial |
| [new-012](https://www.instagram.com/reel/Db-k43WRXAN/) | _k.elsie | WT | 33 | 1.5 | This property went under contract in five days and the part that most people don't know is | Bridge walk; house photo card; 'Presentation' pill; strike-through 'and I didn't'; 'Expectations' / 'Honest' labels |
| [new-013](https://www.instagram.com/reel/Db24FERRH8D/) | _k.elsie | SI | 34 | 1.49 | I became a Homes .com member years ago and here's what happened to my listings almost over | Homes.com sponsored; grey 'YEARS' big behind; 3D-tour website screenshot; 'at no cost for my sellers'; 'Visibility' / 'Buyers' labels |
| [new-014](https://www.instagram.com/reel/DbvIz5iRf_M/) | _k.elsie | HT | 68 | 6.21 | No, I'm not AI, but the location of this house might make you think it's | Golf swing; property aerial; host standing; fire pit; rooms; 'Oliver's Landing' |
| [new-015](https://www.instagram.com/reel/DbLDJGzRNLv/) | _k.elsie | HT | 75 | 6.82 | Finally, a luxurious day sitting on over four acres in the Webchapel | '4 acres Webbs' serif over aerial; rooms with small labels ('Hardwood', 'main level', 'oversized') |
| [new-016](https://www.instagram.com/reel/DbGU5rwRpYs/) | _k.elsie | SI | 40 | 1.77 | When I list a home, it doesn't just fill in a website and hope for a buyer to scroll by. I | Homes.com: 'When I list a HOME website'; 'buried beneath listings'; orange ring; website screenshot |
| [new-017](https://www.instagram.com/reel/Daz6s1XxjWw/) | _k.elsie | SI | 37 | 1.08 | If your home is listed online right now, there's a good chance the person answering buyer  | Red jumpsuit; 'NEVER'; 'SOMEONE who'; white-flash transition; 'BETTER' |
| [new-018](https://www.instagram.com/reel/DakfKggxD3h/) | _k.elsie | HT | 58 | 3.62 | Anytime I see a fence like this it just makes me want to put on my cowgirl hat and | 'wanna put on my cowgirl hat'; new-build exterior; rooms; 'HOA'; aerial lot |
| [new-019](https://www.instagram.com/reel/DaVDGW6hTzI/) | _k.elsie | HT | 83 | 5.88 | — | Aerial; 'sleek,' kitchen; FPV forest 'leading out'; rooms; standing on stairs |
| [new-020](https://www.instagram.com/reel/DZ7R-D8xNhT/) | _k.elsie | HT | 53 | 5.51 | Find me a better price for a square foot. Until then, check out these. | 'until then' serif blue; aerials; rooms; seated close |
| [new-021](https://www.instagram.com/reel/Dco2pEDI2JH/) | joshiscohen | CF | 70 | 5.29 | — | Letterboxed '701 SANCTUARY DRIVE / SERHANT.' title card; 37 cuts; logo end |
| [new-022](https://www.instagram.com/reel/DcgSAa5xepd/) | joshiscohen | CF | 108 | 5.84 | — | Letterboxed 108s coastal-estate film; 63 cuts |
| [new-023](https://www.instagram.com/reel/Db3Ii0BRG4A/) | joshiscohen | CF | 54 | 6.51 | What if I told you that this home is located and what forbes his name | VO-led: stacked blue/white serif-italic caps ('TOP EXCLUSIVE GATED COMMUNITIES IN THE NATION', 'NO FIXED BRIDGES', 'PRIVATE CEOS'); speaker cameo |
| [new-024](https://www.instagram.com/reel/Dbze287zhKy/) | louisporcellini | HT | 47 | 5.48 | This is Center Island, Long Island's most private luxury enclave. | 'most' serif; circular stat ring '5%'; 'Exclusivity'; '40 min to the'; lake; skyline 'Downtown' |
| [new-025](https://www.instagram.com/reel/DZpOgdUR5tU/) | _k.elsie | HT | 45 | 1.34 | What if you could see your future home before it was even built? | New construction: 'before' / 'Welcome' big; subdivision aerial; '$285,000'; 'from Downtown' |
| [new-026](https://www.instagram.com/reel/DZUoSk6xbJ2/) | _k.elsie | SI | 66 | 1.53 | Welcome! I'm Kelsey Blevins and here is something that most sellers don't | Seated chair; 'AGENTS' red; floating listing cards; document; team photo |
| [new-027](https://www.instagram.com/reel/DfFQiNCT8Lj/) | barsolmedia | SI | 42 | 3.56 | So you're trying to sell a two million dollar listing with 40 photos on a floor plan, | Barsol editorial: red/black collage '20000000s million'; curved 'don't feel' text; photos scattered on grass; arc 'they're closing'; flags; logo end |
| [new-028](https://www.instagram.com/reel/DeuDl-0TDhJ/) | barsolmedia | WT | 77 | 5.62 | Hold on. Hold on. Let me just let me call you back. Okay So | Two agents walk-and-talk skit; 'THE PRICE'; 'PRIVACY' big; 'DOES'; 'AUTOCORRECT' |
| [new-029](https://www.instagram.com/reel/CzKqx6gsmRO/) | reesekiselakrealtor | POV | 10 | 4.88 | This is what you can get in Salinas, Texas. Let's go check it out. | 10s; header 'Located in Celina, TX / prices starting from'; 'Located 35 min from Dallas'; walk in; rooms |
| [new-030](https://www.instagram.com/reel/Df4kCy6BktT/) | reesekiselakrealtor | POV | 71 | 1.27 | This is the dream bathroom setup. Of course, you have your double vanity, walk -in | 71s handheld walkthrough; host gesturing/dancing through bath, closet, laundry |
| [new-031](https://www.instagram.com/reel/DfzacQQhDTi/) | reesekiselakrealtor | POV | 76 | 3.83 | This is what you can get sitting on over two acres, just 30 minutes from the airport. Let' | 'POV: You found your dream home' small top; small captions low ('Just wait till we get to the closet') |
| [new-032](https://www.instagram.com/reel/DfmicmxhH8L/) | reesekiselakrealtor | POV | 19 | 5.82 | — | Meme caption 'getting robbed but I'm walking by a beautiful house'; rooms montage |
| [new-033](https://www.instagram.com/reel/Dfj9q6sB1Fz/) | reesekiselakrealtor | POV | 21 | 0.97 | — | Sunset exterior; small serif 'POV: you move to TX for your dream home'; 21s |
| [new-034](https://www.instagram.com/reel/DfZqgLHhSon/) | reesekiselakrealtor | POV | 24 | 0.42 | — | Two-storey closet tour; 'POV: you move to TX and your closet has a second floor' |
| [new-035](https://www.instagram.com/reel/DfUg5ZjB2XE/) | reesekiselakrealtor | POV | 52 | 2.86 | This is what you can get starting in the low 500 ,000s. Let's go check it out. Could you i | 'Starting from $500ks / FOR SALE NOW $700K' bold italic; host walks through rooms |
| [new-036](https://www.instagram.com/reel/DfPXYgwB3q8/) | reesekiselakrealtor | POV | 10 | 1.05 | — | 10s poll: 'Which home are you choosing? 1 / 2 / 3' |
| [new-037](https://www.instagram.com/reel/DfHiJDkhO49/) | reesekiselakrealtor | POV | 75 | 4.14 | Starting at a million dollars, you can be in a gated community just five minutes from PGA. | 'Located in Prosper TX / FOR SALE NOW'; bold uppercase single-word captions low ('BOOKMARKED', 'HONESTLY', 'TUB') |
| [new-038](https://www.instagram.com/reel/DfnDm0wOXFR/) | michaelaziz.vs | CF | 30 | 12.05 | — | Architectural film (quonset homes); night pool; FPV; people; 30s, 36 cuts |
| [new-039](https://www.instagram.com/reel/DfX70wSuAKG/) | michaelaziz.vs | CF | 64 | 5.97 | — | Night exterior with light beams; sunset; FPV; pool; 38 cuts |
| [new-040](https://www.instagram.com/reel/De9O4AqhzwI/) | reesekiselakrealtor | HT | 83 | 3.87 | Guys, it's me, Reese. Welcome back to part 19 of building | Construction series 'part 19 of building'; crew; captions; rebar top-down |
| [new-041](https://www.instagram.com/reel/DeyIyOLRkwQ/) | reesekiselakrealtor | HT | 59 | 5.95 | — | Seated intro; exteriors; aerial; rooms; zoom-blur transitions |
| [new-042](https://www.instagram.com/reel/DerNZDaBp4s/) | reesekiselakrealtor | HT | 32 | 6.55 | We are five minutes from the QGA, five minutes from Universal Studios, Kent's theme park, | 'We are five minutes from the PGA' with PiP aerial card; walking; rooms |
| [new-043](https://www.instagram.com/reel/Deje-FUhq_C/) | reesekiselakrealtor | HT | 78 | 5.13 | — | 'sacrificing house' magenta/yellow; 'OH' yellow; porch; pool; rooms |
| [new-044](https://www.instagram.com/reel/DeeVW2WhPlm/) | reesekiselakrealtor | HT | 38 | 5.56 | — | Extreme close-up face in sunglasses hook; Spanish-style exterior; rooms; minimal text |
| [new-045](https://www.instagram.com/reel/DeO4mtsBiNK/) | reesekiselakrealtor | POV | 106 | 4.23 | This is what you can get for four million dollars. Okay, so we're about 30 minutes outside | Serif box 'New Construction For Sale Now / LOCATED IN FAIRVIEW TX'; serif-italic mid-frame captions ('this community', 'fixtures, tiling') |
| [new-046](https://www.instagram.com/reel/DeJ6zLfxH1J/) | reesekiselakrealtor | POV | 84 | 3.94 | Okay, well you said you wanted something custom, right? One of a kind and on | Phone-call skit hook; small captions; rooms |
| [new-047](https://www.instagram.com/reel/Dd9NpDHRxnB/) | reesekiselakrealtor | HT | 54 | 5.76 | Reese where are we the | Golf-cart 'Reese...' yellow; 'Lake Lewisville' magenta; drone; zoom blur |
| [new-048](https://www.instagram.com/reel/Ddz_I9WRsEC/) | reesekiselakrealtor | HT | 39 | 4.84 | This home plays in a completely different league. Main house, guest house, | Soccer-ball skit; 'outdoor kitchen' labels; 'Elevated', 'Soaring ceilings' bold italic; 'wait till you see'; aerial |
| [new-049](https://www.instagram.com/reel/Ddez-vbgRPI/) | obxislandguy | WT | 34 | 0.87 | Most homes in the Outer Banks aren't just houses, they're actually income -producing | Multi-colour huge words; '$200,000'; 'not just an investment property'; logo end |
| [new-050](https://www.instagram.com/reel/DccC9ZXBLsJ/) | realestate.theresa | MONT | 60 | 5.69 | — | Luxury lifestyle (supercar, helicopter, yacht) intercut with homes; 34 cuts |

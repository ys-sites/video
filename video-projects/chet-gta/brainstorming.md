# Chet GTA — brainstorming (living memory)

Campaign: **Chet GTA** · Client: **Qin Academy** · Format: 9:16 reel · Started 2026-11-27

This file is the memory of the project. Every prompt about Chet GTA, and what came out of it, is logged here in order, so each new iteration builds on everything before it instead of starting from scratch.

---

## How this file works (read before every Chet GTA task)

**Hierarchy:** Campaign → Step (00 Plan · 01 Assets · 02 Voice · 03 Manga storyboard · 04 Higgsfield scenes · 05 Edit & deliver) → Iteration (one per prompt) → Decisions.

**Every turn on this project:**
1. Read **§1 Canon** (what's true right now), **§2 Open questions**, and the **last three iterations** in §3.
2. Do the work. If the new prompt contradicts the Canon, the newest prompt wins. Update the Canon line and mark the old value `~~struck~~ (→ I-00N)` so the history stays visible.
3. Append a new iteration at the **bottom** of §3 with the user's prompt **verbatim**, how it was read, what was produced (files and a summary), the decisions that changed, the new open questions and the next step.
4. Never delete an iteration. Fix mistakes in a later iteration.

---

## 1. Canon (current state, always up to date)

### Concept
- **Logline:** Qin Academy tutor **Chet** lives inside a GTA VI-style open world. Every student text raises his "Finals Level" stars until a grocery checkout turns into a *trans-action* (trance + transaction). He escapes to his car and calls the one person who can finish the final crash course: **Sobhi**, the real-life gamer who has been playing Chet the whole time.
- **The device:** two layers on one screen. The top is the game (AI-generated, GTA VI-inspired look). The bottom is a facecam **bubble** of Sobhi playing in real life, reacting like a streamer. The payoff breaks the fourth wall: the game character phones the player.
- **Marketing goal:** announce **Final Crash Courses** (ENGR 213 · MATH 205 · CHEM 205 · PHYS 205) and position Qin Academy as the place students already text when finals hit.
- **CTA (draft):** "Final Crash Courses — dropping soon. Comment your course." + Qin Academy.

### Characters
| Character | Layer | Role |
|---|---|---|
| **Chet** | Game (GTA VI-style) | Main character, Qin Academy tutor. Overwhelmed, kind, a beat behind |
| **Sobhi** | Real life (bubble) | The gamer playing Chet; streamer-style reactions; working on the crash course |
| **Student** (name TBD) | Game | Did well on midterm 2 thanks to Chet's review; asks about the final crash course |
| **Cashier** | Game | "Is that all for today?" Her voice becomes the student question during the trance |
| **Texting students** | Phone UI only | Senders of the text barrage |

### Format
- 9:16 vertical reel, 1080×1920, about 55–60 s (cut-down to ~30 s possible later).
- Visual generation: **Higgsfield** (characters, locations, scenes). Edit, HUD, phone UI, bubble and captions are assembled locally.

### Storyline (current version → `story/storyline.md`)
1. KD aisle: Chet picks up a box of KD, looks at it, puts it in his basket (~5 s).
2. Text barrage: the courses pile up; each text adds a Finals Level star.
3. Student encounter: thanks for the midterm 2 review, "Is there a final crash course?" "Yes, we're working on something."
4. *(proposed)* Five-star rush: more students spot him; quick GTA-style escape to the till.
5. Cashier: "Is that all for today?" KD scanned.
6. **Trans-action:** the trance. The cashier's voice becomes "When is the final crash course coming?"
7. Snap back: "Credit or cash? … Sir, are you listening to me?" He pays.
8. Car: Chet gets in and calls Sobhi.
9. Fourth wall: Sobhi's real phone rings mid-game. Chet: "Can we finalize?" Sobhi: "It's gonna be done soon."
10. End card: Final Crash Courses, course codes, Qin Academy, CTA.

### Production steps (→ `PIPELINE.md`)
00 Plan (this file, storyline) → 01 Assets (character, object, location sheets) → 02 Voice foundation (one locked voice per character) → 03 Manga storyboard (one panel per action) → 04 Higgsfield scene-by-scene generation → 05 Edit, sound, captions, delivery.

### Guardrails
- "GTA VI-**inspired**" look only: no Rockstar or GTA logos, wordmark, exact HUD, or exact "WASTED / MISSION PASSED" cards. Use original on-screen wording and fonts.
- Real brands (KD / Kraft Dinner) and real people's faces or voices need the owner's OK. Clone a voice only with the person's consent.
- Every pulled repository stays reference-only until it passes the workspace security gate (`python tools/security_gate.py <path>`); approved/ready tools are listed per step in `PIPELINE.md`.

---

## 2. Open questions (answer any time; each answer becomes Canon)

| # | Question | Default until answered |
|---|---|---|
| Q1 | "9 x 12 reel": 9:16 (1080×1920, Reels/TikTok) or a true 3:4 / 9:12 (1080×1440, feed post)? | 9:16 |
| Q2 | Are Chet and Sobhi real people (Qin Academy staff) whose faces and voices we should match? If yes, we need photos and 30–60 s of clean voice from each, with consent | Real people, likeness from photos |
| Q3 | Sobhi's last line: "It's gonna be **done** soon" (the crash course) or "I'm gonna be **home** soon"? | "It's gonna be done soon" |
| Q4 | KD: show the real Kraft Dinner box (needs Kraft's OK for an ad) or a look-alike blue "mac & cheese" box? | Look-alike box, no logo |
| Q5 | Keep the proposed 5-star rush (≈4 s of action) and the streamer reactions from Sobhi? | Keep both |
| Q6 | Is the academy name spelled "Qin Academy"? Logo, colours and font? | "Qin Academy", brand kit TBD |
| Q7 | Student's name, and the city (Montreal / Concordia vibe, or a Vice City-like Florida look)? | Unnamed student; Vice City-style neon look with Montreal winter touches TBD |
| Q8 | Language: English only, or some French (Montreal)? | English |
| Q9 | Which Higgsfield plan / models are available (image + video + audio), and the credit budget? | Ask before the first batch |
| Q10 | Release date of the crash courses (for the end card)? | "Dropping soon" |

---

## 3. Iteration log (oldest first — append new iterations at the bottom)

### I-001 · 2026-11-27 · Step 00 Plan — project kickoff

**Prompt (verbatim):**

> Hey there, I want you to create project Chet GTA, it's a marketing campaign that I'm building for Qin Academy
> And I have an idea of what I want it to have. This is my plan. I want you to take all this data and implemented on on a file call brainstorming and what essentially this file does this MD brainstorming file is brainstorming.MD file does is every time I prompt you kind of use the hierarchy of timeline to really look how the data is being continued of prompting so this prompt is pretty much saved and not only the prompt the output of the prompt so like this you're able to really crap this data in a way that it consistently use every single iteration of implementation without losing that data from the previous chat you know what I mean so that it's consistently marinating while we continue this is the first thing
>
> So far this is the storyline idea I have we have a 9 x 12 real where it's gonna be using Hicks field and we're gonna generate the main character who is Chet
> Who is a Tutor for the Academy and we're gonna prompt in the way we're gonna generate a AI video of him in GTA six styles so we're gonna have the whole video with the GT style and in the bottom we have a bubble who's going to be a person playing the game but in real life, but we're gonna also generate that character and that character name is Sobhi
>
> The scene starts with the character being in front of KD Kraft dinner I'll and it's taking the kitty product and looking at it and put it in his basket, so this should take about five seconds, and then the character Chet receive continuous message where each message is asking him he I need a final crash course for Ian GR 213. I need to study for math 205 my finals for Chem 205 isn't two weeks. I need to know if there's a final recap in another text for Physics 205 so I'm gonna tell you what the tax is gonna have after I'm just giving you some ideas how the character is overwhelmed with the text and and has Chet continues he sees one of the student students and the students say hi  Chet how are you doing? Thank you for the reviews for Mitch too. I actually did pretty good on the test. My finals are coming up. I want to know if there's going to be a final crash course and the character replies yes we're working on something and then the character goes to the cashier and a cashier ask is that for today and he gives the Katie food whatever it's going through the basically the cashier takes the food and this specific one is what's we gonna call a transaction so the character goes on a trance where he's gonna imagine or just lost with thoughts where he hears the cashier saying something, but it is translated in his Mind. Hey, I want to know when is the final crash course coming and Chet gets lost in the trance and after we recap a bit and the cashier say do you wanna pay credit card or cash and she's like Mr. are you listening to me basically kind of showing that the character was lost at that moment in time and really get his conscious and then he pays that he goes to his car and then he calls sobhi who is the gamer so he receives the call and then Chet ask can we finalize, sobhi reply
> It's gonna be home soon
>
> So far this is what I have in mind for the script and the storyboard I want you to implement kind of an action to it something that will not lose the person retention something revolving with GTA six but still being in the context of marketing for the academy first build the structure like I said, understand the storyline that I have and then once everything done, I'll let you know what's the next step and a few things you wanna know is you're gonna be using a lot of video generating AI system that I have pulled for this project for example all of the pulled peoples that benefits Hicksville or not just hateful just in general when it comes to prompting planning the directory all that will be used every single one of it will be used and you want a kind of breakdown into few step step one would be the asset which would be the character sheet object sheet the location and step two would be replicating the character's voice, and you will be using all of the voice that you have pulled, and you can use that to best of the ability to replicate the character voice, and that would be the foundation when it comes to the voice of the character throughout the video step three would be creating like a manga type drawing of every single action that that's gonna be placed basically like you could say that every frame what we're trying to show the AI the planning and then we're gonna break down scene by scene using Higgsfield
> Anything hicksville is Higgsfield

**How it was read (voice-to-text corrections):**
- "Hicks field / Hicksville / hateful" → **Higgsfield**. "9 x 12 real" → a vertical **reel** (see Q1). "GT style" → GTA VI style.
- "KD Kraft dinner / kitty product / Katie food" → **KD (Kraft Dinner)**.
- "Ian GR 213" → **ENGR 213**; "math 205" → **MATH 205**; "Chem 205 isn't two weeks" → **CHEM 205 is in two weeks**; "Physics 205" → **PHYS 205**.
- "reviews for Mitch too" → "the review for **midterm 2**".
- "is that for today" → "Is that **all** for today?"
- "transaction" → the pun **trans-action**: the trance happens during the transaction.
- "Mr. are you listening to me" → "**Sir**, are you listening to me?"
- "It's gonna be home soon" → probably "It's gonna be **done** soon" (Q3).
- "all of the pulled peoples" → all the pulled **repos/tools**.

**Output:**
- Created `video-projects/chet-gta/` with:
  - `brainstorming.md` (this file): protocol, Canon, open questions, iteration log.
  - `story/storyline.md`: beat-by-beat script with timecodes, the Sobhi bubble track, the HUD layer, the scene list, and the retention devices added.
  - `PIPELINE.md`: Steps 01–05 with deliverables, gates, folder layout, and every pulled tool mapped to the step it serves (with its approval status).
  - Step folders `01-assets/`, `02-voice/`, `03-manga-storyboard/`, `04-higgsfield-scenes/`, `05-edit/`, each with a README checklist.
  - `project.json` and a project `AGENTS.md` telling any future session to read and append to this file.
- Added the project to the workspace router and the root `AGENTS.md`, so every new chat finds this file.

**Added for retention (proposed, all in the storyline):**
1. **Finals Level stars**: a GTA wanted-level parody. Each text adds a star; at five stars the trance hits.
2. **Mission HUD**: "OBJECTIVE: Buy groceries" changes to "OBJECTIVE: Survive finals season".
3. **Sobhi as a streamer**: short reactions in the bubble ("He's got four stars. He's cooked.") give a second voice every 5–8 s.
4. **Five-star rush**: students appear at the ends of the aisles with phones out; Chet speed-walks with his basket in a fast montage cut on the beat.
5. **Trans-action**: a title-card pun, slow motion, a neon colour shift and the earlier texts echoing as whispers.
6. **Fourth-wall payoff**: the game character calls the real player; the bubble grows to take over the frame.
7. **Loop ending**: the last frame matches the first (Sobhi: "…he's buying KD again"), so the reel replays.

**Mid-turn follow-up (verbatim):** "Fix anything cut". The user's screenshot showed two failed lookups: a PowerShell listing with no permission verdict, and a search of `video-projects/*/*` that timed out. Both were re-run through Bash with the same scope, so nothing was skipped. All the project files above were written in full.

**Decisions:** Canon §1 set for the first time. Step order locked: Assets → Voice → Manga storyboard → Higgsfield scenes → Edit.

**Open questions:** Q1–Q10 (§2).

**Next step:** waiting on the user. Suggested: answer Q1–Q4, send Chet and Sobhi reference photos and voice samples, then start Step 01 (character sheets).

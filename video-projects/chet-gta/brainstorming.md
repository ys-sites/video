# Chet GTA — brainstorming (living memory)

Campaign: **Chet GTA** · Client: **Qin Academy** · Format: 9:16 reel · Started 2026-11-27
Read on iPad: **Chet GTA Files** — https://claude.ai/artifact/MPWpMx2mhX1k4e94uEWk2C (rebuild with `python -I build_viewer.py <out.html>` and republish after each iteration)

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
- **Logline:** Qin Academy tutor **Chet** lives inside a GTA VI-style version of **Montreal**. Student texts about finals pile up ~~and raise his "Finals Level" stars~~ (→ I-003, parked) until a grocery checkout turns into a *trans-action* (trance + transaction). He escapes to his car and calls **Sobhi**, the real-life gamer who has been playing Chet the whole time and is behind the crash course.
- **The device:** two layers on one screen. The top is the game (AI-generated, GTA VI-inspired). The bottom is a circular facecam **bubble** of Sobhi playing in real life (generated, photoreal). During the call the bubble **grows to fill the bottom half** of the screen (→ I-003). The payoff breaks the fourth wall: the game character phones the player.
- **Marketing goal:** announce **Final Crash Courses** (ENGR 213 · MATH 205 · CHEM 205 · PHYS 205) and position Qin Academy as the place students already text when finals hit.
- **CTA (draft):** "Final Crash Courses — ~~dropping soon~~ **announced soon** (→ I-003). Comment your course." + Qin Academy logo (taken from @qinacademy).

### Characters
| Character | Layer | Look | Voice | Role |
|---|---|---|---|---|
| **Chet** | Game | GTA VI-style version of the **real Qin Academy tutor** Chet (likeness from @qinacademy reels and photos, with consent) | **Clone** of the real tutor (recording with consent) | Main character. Overwhelmed, kind, a beat behind. He features most in Qin's recent videos |
| **Sobhi** | Real life (bubble) | **Real person, generated photoreal** (not GTA style), from his photos and reels | **Clone** of Sobhi (recording with consent) | The gamer playing Chet; mostly silent facial reactions, two lines plus the call |
| **Student** | Game | **Invented** original character (suggested: female Concordia engineering student; name TBD) | Designed voice | Did well on midterm 2 thanks to Chet's review; asks about the final crash course |
| **Cashier** | Game | Invented, Montreal grocery cashier | Designed voice, plus the processed trance version | "Bonjour-hi! Is that all for today?" |
| **Rush students** | Game | Invented, 2–3 extras | Short shouts | Swarm Chet in the aisle |
| **Texting students** | Phone UI only | — | — | Senders of the texts |

The real people's personalities, catchphrases and running jokes come from the @qinacademy reel study (pending).

### Format
- **9:16** vertical reel, 1080×1920, 30 fps, about 55 s (→ I-003, confirmed).
- World: **Montreal rendered GTA VI-style**: a downtown grocery (IGA/Metro feel), snow, a Concordia-area street, a parking lot (→ I-003).
- Language: **English with a little French** (Montreal touches: "Bonjour-hi!", French store signage) (→ I-003).
- Visual generation: **Higgsfield** on a **small budget**: one take per shot, re-roll only failures, credits approved per step (→ I-003). Edit, HUD, phone UI, bubble and captions are assembled locally.

### Storyline (current version → `story/storyline.md` v2)
1. KD aisle: Chet picks up a **real KD box** (→ I-003), looks at it, puts it in his basket (~5 s). Sobhi, bubble: "Bro… he's buying KD again."
2. Text barrage: ENGR 213 · MATH 205 · CHEM 205 · PHYS 205 messages pile up on his phone. ~~Each text adds a star~~ (→ I-003, parked).
3. Student encounter: thanks for the midterm 2 review, "Is there a final crash course?" "Yes, we're working on something."
4. **The rush** (kept, → I-003): more students spot him, "Chet! The crash course!"; he speed-walks to the till.
5. Cashier: "Bonjour-hi! Is that all for today?" KD scanned.
6. **Trans-action:** the trance. The cashier's voice becomes "When is the final crash course coming?"
7. Snap back: "Credit or cash? … Sir, are you listening to me?" He pays.
8. Car: Chet gets in (Montreal snow) and calls Sobhi.
9. Fourth wall: Sobhi's real phone rings mid-game; **the bubble grows to half the screen**. Chet: "Sobhi. Can we finalize?" Sobhi: ~~"It's gonna be done soon."~~ "**It will be announced soon.**" (→ I-003)
10. End card: Final Crash Courses, announced soon, course codes, Qin Academy logo, CTA. ~~KD-again loop~~ (→ I-003, parked).

**Sobhi's lines (→ I-003, fewer lines):** start "Bro… he's buying KD again." and the phone call. Otherwise silent facial reactions.

### Parked ideas (future iterations)
- **Police-chase wanted stars:** stars fit a real chase better than a stress meter. Use them if a later version has students or cops chasing Chet (→ I-003).
- **"He's buying KD again" loop ending** (→ I-003).

### Production steps (→ `PIPELINE.md`)
00 Plan (this file, storyline) → **00b Reference study of @qinacademy reels** → 01 Assets (character, object, location sheets) → 02 Voice foundation (clones of Chet and Sobhi, designed voices for the rest) → 03 Manga storyboard (one panel per action) → 04 Higgsfield scene-by-scene generation → 05 Edit, sound, captions, delivery.

### Guardrails
- "GTA VI-**inspired**" look only: no Rockstar or GTA logos, wordmark, exact HUD, or exact "WASTED / MISSION PASSED" cards. Use original on-screen wording and fonts.
- **Real KD box:** the user chose it and takes responsibility for Kraft Heinz's permission. Logos may come out garbled from AI generation; plan to fix the label in the edit if needed.
- Real people (Chet, Sobhi): faces and voices are used only with their consent. Clones are made only from recordings they provide.
- Instagram is studied only through videos the user saves into `input/qin-instagram/`. No scraping past Instagram's login.
- Every pulled repository stays reference-only until it passes the workspace security gate (`python tools/security_gate.py <path>`); approved/ready tools are listed per step in `PIPELINE.md`.

---

## 2. Open questions (answer any time; each answer becomes Canon)

| # | Question | Status |
|---|---|---|
| Q1 | Frame size | ✅ 9:16 (I-003) |
| Q2 | Who are Chet and Sobhi? | ✅ Chet is the real tutor, GTA-styled; Sobhi is real, generated photoreal (I-003) |
| Q3 | Sobhi's last line | ✅ "It will be announced soon" (I-003) |
| Q4 | KD box | ✅ Real KD box (I-003) |
| Q5 | Retention additions | ✅ Rush and bubble takeover kept; Sobhi down to 2 lines; stars and loop parked (I-003) |
| Q6 | Name and brand | ✅ "Qin Academy", @qinacademy; logo and colours taken from Instagram (I-003) |
| Q7 | Student and world | ✅ Invented student; Montreal, GTA-style (I-003). **Open:** the student's name |
| Q8 | Language | ✅ English with a little French (I-003) |
| Q9 | Higgsfield budget | ✅ Small budget (I-003). **Open:** exact plan and credit number |
| Q10 | Launch and post dates | ⏳ User will add later; end card says "announced soon" until then |
| Q11 | @qinacademy reels | ⏳ User saves the reels into `input/qin-instagram/`; then the character study runs |
| Q12 | Voice recordings | ⏳ 30–60 s clean recordings of Chet and Sobhi, with their consent, into `input/` |
| Q13 | Photos | ⏳ Clear photos of Chet and Sobhi (front, side, full body) into `input/`, unless the reel frames are enough |

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

### I-002 · 2026-11-27 · Step 00 Plan — view the files on iPad

**Prompt (verbatim):**

> I'm using remote access to Claude from my iPad, show the files created, so I can open and read the file
> Output to here, where I open and view the file

**How it was read:** the user works from an iPad over remote access and wants to read every project file inside the Claude app.

**Output:**
- Direct file sending failed: this session has no project thread to put files in.
- Published a private Artifact page, **Chet GTA Files** (https://claude.ai/artifact/MPWpMx2mhX1k4e94uEWk2C), with one tab per file: brainstorming, storyline, pipeline, project rules, project.json and the step checklists. It is rebuilt from the files on disk each time it is republished.
- The same files are on GitHub: `ys-sites/video`, `main` branch, `video-projects/chet-gta/`.

**Decisions:** after each iteration, republish the Chet GTA Files page so the iPad view stays current.

**Open questions:** unchanged (Q1–Q10).

**Next step:** waiting on the user (answer Q1–Q4, then start Step 01).

### I-003 · 2026-11-27 · Step 00 Plan — question round 1 (answers so far)

**Prompt (verbatim):** "Ask me all the questions u need one by one / So u can enhance the data". Mid-turn: "Keep in mind".

**Answers (verbatim where typed):**
| Q | Asked | Answer |
|---|---|---|
| Q1 | Frame size | **9:16 Reel** (1080×1920) |
| Q2 | Who are Chet and Sobhi? | "Sobhi is real, but will be generated still, but will have realism where a Chet is the game character, will have the gta 6 style" |
| Q2b | Chet's face | **Based on a real tutor** (the real Chet from Qin Academy's videos) |
| Q2c | Voice samples | **Yes, both**: clean recordings of the tutor (Chet) and Sobhi, with consent |
| Q3 | Sobhi's last line | "**It will be announced soon**" |
| Q4 | KD box | **Real KD box** (the user takes responsibility for Kraft Heinz permission) |
| Add-1 | Finals Level stars + HUD | "nice concept, but … stars would do better if police chase was happening rather than stress level increasing … keep that thought in mind … future iteration" → **parked** |
| Add-2 | Sobhi streamer reactions | **Fewer lines**: only 2 reactions (start and end), otherwise silent facial reactions |
| Add-3 | The rush (students swarm, Chet escapes) | "Keep the" → read as **keep** |
| Add-4 | Bubble takeover + KD loop | "Forget the kd again, but I love the circl, growing into half screen" → **takeover kept, loop dropped**; "Keep in mind" read as **park the loop idea** for later |
| Q6 | Academy name and brand | "search on instagram, from Qin academy … look at the characters … Chad [Chet] and the other dude is sobhi … scan through every single of their videos … The recent videos is more on chat [Chet]" → research task started |

**Parked ideas (future iterations):** police-chase wanted stars (students or cops chasing Chet, stars filling up); the "he's buying KD again" loop ending.

**Answers, continued:**
| Q | Asked | Answer |
|---|---|---|
| Q6 handle | Exact Instagram handle | https://www.instagram.com/qinacademy/ |
| Access | How to get the reels | Instagram shows a login wall. Listing the profile with yt-dlp failed (marked broken), and a call to Instagram's internal API was refused by the permission check as unauthorized access, so it was not retried. User chose: **"You save the videos"** into `input/qin-instagram/` |
| Q7a | The student | **Invented student** |
| Q7b | The world | **Montreal, GTA-style** |
| Q8 | Language | **English + a little French** |
| Q9 | Higgsfield budget | **Small budget** (the exact plan and credits come later) |
| Q10 | Dates | "I'll add later" |
| Q6 logo | Logo and colours | **Take it from Instagram** |

**Output:**
- Canon §1 and the open questions §2 rewritten with every answer; old values struck with → I-003.
- `story/storyline.md` updated to v2 (stars removed, Sobhi down to two lines, rush kept, bubble takeover, Montreal, French touches, new final line, real KD, no loop).
- Created `input/qin-instagram/README.md`, the drop folder for the reels.
- Rebuilt and republished the Chet GTA Files page.

**Decisions:** see the Canon (each one is marked → I-003). A new step **00b, the @qinacademy reel study**, comes before Step 01, because Chet's and Sobhi's looks, voices and personalities come from their real videos.

**Next step:** the user saves the @qinacademy reels (Chet-heavy recent ones first), plus voice recordings and photos if available. Then: run the reel study (frames, transcripts, character notes) → write the character bibles → Step 01 sheets.


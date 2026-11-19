# Creator-style explainer

An 84-second 9:16 video that explains the creator-style system: the 136-reel study, the 12 reel types, the measured rules and the workflow used when someone asks for an edit "in creator style". The video itself follows the study's rules (hook in the first frame, two-tier text, white plus one accent, one clear ask at the end).

- Numbers come from `skills/creator-video/references/real-estate-creator-study.md`.
- No third-party footage is used; the presenter in the "look" scene is a drawn stand-in.
- Sound effects stream from remotion.media at render time.

```bash
npm i
npx remotion studio          # preview
npx remotion render CreatorStyleExplainer out/creator-style-explainer.mp4 --crf=24
```

The site copy lives at `public/videos/creator-style-explainer.mp4` (re-muxed with `-movflags +faststart`).

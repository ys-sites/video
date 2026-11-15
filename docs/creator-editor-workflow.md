# Creator editing workflow

This is an independently authored workflow based on the user's pasted summary of Torsten Roscoe's video, “How to Edit Videos With Claude.” The video names seven rule-book topics but does not provide the actual paid bundle or the creator's private skill. The starter rules in this workspace are not copies of those materials.

For a new project, run:

```powershell
python tools/video_workflow.py init my-project
```

This creates `video-projects/my-project/` with `input/`, `references/good/`, `references/bad/`, seven editable rule books, `notes/`, `variants/`, and `exports/`. The folders are local and Git-ignored. Add or ingest authorized reference and source media, and explain what you like or dislike. Keep project-specific approved taste decisions in `notes/taste.md`; record versioned time- or frame-specific corrections in `notes/revisions.md`. Empty folders are not evidence that a taste has been learned.

The seven initial rule books cover pacing, cutting, curiosity, emotion, captions, sound, and motion/color. They are starting points: actual footage, approved references and the user's instructions determine the edit. Do not cut every pause mechanically; intentional speech and reactions can matter.

To plan separate treatments of the same cut:

```powershell
python tools/video_workflow.py variants my-project --styles creator business explainer split-screen sass
```

This creates separate JSON planning records that refer to the same `cut-plan.json`. They are not renders, and the shared cut is not available until it is actually reviewed and recorded. Populate each direction with its own meaningful visual and audio choices, render only when requested, and compare results. Platform distribution and duplicate-detection behavior are not guaranteed, and no posting is authorized by this workflow.

The existing `creator-video` skill routes relevant tasks and uses the workspace's available tools. FFmpeg and FFprobe are available through the path recorded in `docs/caption-skill-setup.md`; Node, Python and a local faster-whisper environment are also present. Remotion is described in the source summary but is not set up as a renderer by this workflow. A real edit still needs source media, a chosen tool, and verification of the output.

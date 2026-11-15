export type StyleProfile = { id: string; name: string; description: string; palette: string; format: string; duration: string; motion: string[]; pieces: string[]; promptSuffix: string; source: string; category?: 'study' | 'creator' };
export const vox: StyleProfile = {
  id: 'vox-paper-collage', name: 'Vox paper collage', description: 'A story assembled from printed cut-outs, paper textures, maps and word-by-word headlines.',
  palette: 'Cream paper #EDE6D6 · faded warm ink · restrained red accent', format: '1920 × 1080 · 16:9 · 25 fps', duration: 'About 12 seconds, adjusted to the story',
  motion: ['Build from back to front: sky, clouds, landscape, landmark, ground, then the subject.', 'Ease arrivals over 0.5–0.8 seconds from 40–80 px away; no bounce or overshoot.', 'Keep subtle continuous movement in clouds, birds or vehicles and push the camera 3–5% over 12 seconds.', 'Bring title scraps in word by word, about 0.1 seconds apart; hold long enough to read.', 'Give facts their own visual beat and show the story’s change before and after.'],
  pieces: ['Sky band', 'Separate clouds', 'Landscape or skyline strip', 'Story landmark', 'Ground or road', 'Hero subject', '1–3 moving elements', 'Map and pin', 'Newspaper fact clipping', 'Separate word scraps'],
  promptSuffix: 'Style: a cut-out from a vintage 1960s travel magazine, printed photo with visible halftone dots, slightly faded warm inks, matte paper grain, cut out by hand with a thin torn white paper border all around, a soft paper curl at one edge. Isolated object, nothing else in frame, transparent background. No text, no logos, no watermark.',
  source: 'Vox guide.md and Vox Explainer Guide - justdodani.pdf, supplied by the user.'
};
export const captionReel: StyleProfile = {
  id: 'talking-head-captions', name: 'Talking-head captions',
  description: 'Speech-led, layered captions with expressive keywords, subtle depth, and frame-specific revisions.',
  palette: 'One readable base color · one purposeful accent · match the footage',
  format: '9:16 vertical · match the project frame rate', duration: 'Follow the actual spoken edit',
  motion: [
    'Study 3–5 supplied reel references when available; note typography, placement, entrances, exits, depth, pacing and sound.',
    'Correct the transcript against final speech, then check each displayed word’s onset against the waveform and audio. Verify on playback; automated timestamps are starting points.',
    'Choose one clear base font and one contrasting emphasis font. Keep a consistent base color and use accent color purposefully for selected words.',
    'Layer the background, behind-subject words, a clean subject matte, and foreground words. Use subtle camera movement only when the footage and matte support it.',
    'Plan quiet ticks or whooshes for animated events when sound fits the brief; place them on the event frame and keep the voice clear.',
    'Keep important captions clear of the lower third and right-side interface where feasible, then review legibility and actual platform framing.',
    'Record feedback at the exact time or frame and preserve approved style decisions in a project-specific taste file.'
  ],
  pieces: ['Final footage and speech', 'Reviewed transcript and word timings', 'Two licensed typefaces', 'Editable foreground and background text', 'Subject matte or foreground-only fallback', 'Optional room reference or replacement', 'Licensed sound accents', 'Frame-specific review notes'],
  promptSuffix: 'Use editable text for accurate spelling. Preserve speech fidelity, comfortable reading time, contrast, and the visible subject. Confirm source and licensing for any added visual or sound.',
  source: 'User-provided "How I edited my captions reel with AI" text and images; Motion Video Director v3.5.2 supplied plugin.'
};
export const creatorVlog: StyleProfile = {
  id: 'creator-vlog', name: 'Creator vlog',
  description: 'A creator-led short built around the real moments, voice and progression in your footage.',
  palette: 'Match the footage and any approved creator references', format: 'Vertical 9:16 by default · adapt to the brief', duration: 'Set by the footage and story',
  motion: ['Inspect the user’s footage and find a concrete hook, progression and payoff.', 'Use captions, cut rhythm and supporting visuals that fit the story and any supplied reference.', 'Keep important faces, action and text readable in the target frame.', 'Preserve natural speech and use only approved or licensed music, visuals and sound.'],
  pieces: ['User-supplied footage and audio', 'Selected clip ranges', 'Story and shot plan', 'Editable captions', 'Optional licensed music and graphics'],
  promptSuffix: 'Make an original creator-led edit from the supplied material. Match any approved references and preserve the creator’s own voice and story.',
  source: 'User-requested vlog implementation; refine with the user’s supplied footage and reference videos.'
};
export const kelsey: StyleProfile = {
  id: 'kelsey-kelssie3', name: 'Kelsey · creator reel',
  description: 'Talking-to-camera edits with quiet captions, layered hero words and speech-timed proof.',
  palette: 'Footage-led natural tones · clear white captions · selective keyword color', format: '9:16 vertical · match source frame rate', duration: 'Adapt to the actual story and footage',
  motion: ['Use the six selected talking-to-camera references to study composition, sentence changes and emphasis; the excluded montage and tour references are a separate set.', 'Keep running captions concise and readable; add a larger keyword around or behind the speaker when a clean subject matte permits.', 'Time real proof or a clearly illustrative graphic to the relevant spoken idea; never invent testimonials, results or credentials.', 'Use sentence-led cuts and gentle pushes when they support the delivery; source metrics are examples, not fixed targets.', 'Review the actual audio, reference frames and mobile safe areas. Existing transcripts and contact-sheet timing are approximate and need checking.'],
  pieces: ['User footage and original audio', 'Verified transcript and word timing', 'Editable running captions', 'Hero keyword layers', 'Clean person matte when available', 'User-supplied proof or illustrations', 'Review notes'],
  promptSuffix: 'Create an original user-specific edit inspired by the referenced editing techniques. Preserve the user’s own voice and use their actual proof; do not reuse the creator’s footage or identity without permission.',
  source: 'User-provided kelssie3 creator teardown and six local reference videos; see resources/creator-styles/sources/kelssie3-teardown.'
};
const studyProfiles: StyleProfile[] = [
  { id: 'paint-watercolor', name: 'Paint MV · watercolor', category: 'study', description: 'Hand-painted watercolor scenes adapted to an instructional story.', palette: 'Soft watercolor washes, paper texture', format: 'Match the lesson and destination', duration: 'Pace to the lesson', motion: ['Build a scene from successive illustrated layers and gentle transitions.', 'Keep diagrams, labels and instructional content accurate and readable.'], pieces: ['Lesson script', 'Watercolor backgrounds', 'Illustrated elements', 'Narration and captions'], promptSuffix: 'Use original watercolor illustrations to clarify the lesson; the source project is primarily a music-video tool.', source: 'Best match: resources/motion-systems/paint-mv-skills; screenshot source not independently confirmed.' },
  { id: 'hand-drawn-study', name: 'Hand-drawn explainer', category: 'study', description: 'Illustrations and diagrams appear stroke by stroke as a lesson unfolds.', palette: 'Paper, ink and restrained accents', format: 'Match the lesson and destination', duration: 'Allow time for each explanation', motion: ['Reveal meaningful strokes in the order of the explanation.', 'Hold diagrams and equations long enough to read; show worked steps.'], pieces: ['Lesson and worked example', 'Editable illustrations and labels', 'Narration and subtitles'], promptSuffix: 'Use hand-drawn outlines and progressive reveals to explain each concept accurately.', source: 'Best match: resources/motion-systems/hand-drawn-explainer; screenshot source not independently confirmed.' },
  { id: 'anything2explainer-study', name: 'Anything2Explainer', category: 'study', description: 'Chapter-based narrated explainers with animated diagrams and subtitles.', palette: 'Dark canvas and high-contrast diagrams, adaptable to the subject', format: 'Match the lesson and destination', duration: 'Adapt chapters to the material', motion: ['Organize ideas into distinct chapters and animate diagrams in the order explained.', 'Sync subtitles to reviewed narration and preserve readable labels.'], pieces: ['Verified source material', 'Chapter outline', 'Diagrams', 'Narration and subtitles'], promptSuffix: 'Build a source-grounded lesson with clear chapter transitions, diagrams and worked examples.', source: 'resources/motion-systems/anything2explainer (reference only).' },
  { id: 'bang-motion-study', name: 'Bang Motion · educational', category: 'study', description: 'Cinematic motion, camera moves and typography used to explain a lesson.', palette: 'Adapt to the material and legibility', format: 'Match the lesson and destination', duration: 'Adapt to the explanation', motion: ['Use motion and camera changes to reveal relationships, not obscure them.', 'Keep formulas and explanatory diagrams legible and give each concept enough time.'], pieces: ['Lesson outline', 'Diagrams and labels', 'Motion timeline', 'Narration and captions'], promptSuffix: 'Use cinematic motion in service of clear, accurate instructional explanations.', source: 'resources/motion-systems/bang-motion (reference only).' }
];
export const saasLaunch: StyleProfile = {
  id: 'saas-launch', category: 'creator', name: 'SaaS launch · motion',
  description: 'A product launch built around real interface recordings, continuous camera movement and purposeful UI animation.',
  palette: 'Product brand colors · neutral typography · one restrained accent', format: 'Match the intended platform', duration: 'As long as the actual explanation needs',
  motion: ['Analyze supplied reference footage and product recordings before planning the shots.', 'Use editable UI elements, continuous camera moves and transitions that explain real product actions.', 'Synchronize key movements with reviewed narration; preserve readability and redact private screen content.', 'Build a motion-first preview and add licensed, carefully timed sound effects when the brief calls for them.'],
  pieces: ['Product screen recordings', 'Reference analysis', 'Scene storyboard', 'Editable interface elements', 'Reviewed narration', 'Licensed sound cues', 'Versioned review notes'],
  promptSuffix: 'Create an original, evidence-based product video inspired by the supplied references. Verify product claims and protect private data; do not assert MotionSmith is connected.',
  source: 'User-supplied MotionSmith livestream notes and public MotionSmith SaaS Launch style; local interpretation, not the licensed engine.'
};
const animationResources: Array<[string, string, string, string]> = [
  ['anidoodle', 'Anidoodle · drawn in code', 'Hand-drawn illustrations and animated films using procedural artwork.', 'anidoodle'],
  ['huashu', 'Huashu · moving artwork', 'Animate artistic illustrations to support a visual explanation.', 'huashu-art-motion'],
  ['drawing', 'Claude Drawing · illustration', 'Procedural illustration and draw-on effects for lesson assets.', 'claude-drawing-skill'],
  ['character', 'Hand-painted characters', 'Character-led animated storytelling with expressions and movement.', 'claude-animation-base'],
  ['retro', 'Retro collage animation', 'Reference-led collage and vintage editorial imagery.', 'motion-skill'],
  ['principles', 'Motion design principles', 'Apply timing, easing and choreography to an educational animation.', 'motion-design-skill'],
  ['handdraw', 'HandDraw · whiteboard lesson', 'Explain ideas with progressive sketches and narration.', 'handdraw-skill'],
  ['manim', 'Manim · mathematical animation', 'Explain mathematics through animated equations, diagrams and proofs.', 'manim-skill'],
  ['javascript', 'JavaScript · illustrated animation', 'Hand-drawn canvas animation with code-generated visuals and optional sound.', 'javascript-animation-skills']
];
const additionalStudyProfiles: StyleProfile[] = animationResources.map(([id, name, description, folder]) => ({
  id: `study-${id}`, name, description, category: 'study', palette: 'Adapt to subject, reference and readability', format: 'Match the lesson and destination', duration: 'Pace to the explanation',
  motion: ['Explain the concept in meaningful visual steps.', 'Use readable diagrams, accurate labels and timing suited to the learner.'],
  pieces: ['Verified lesson sources', 'Storyboard and worked examples', 'Editable visual assets', 'Optional narration and captions'],
  promptSuffix: 'Use the named source as an unreviewed reference; verify tools, rights and educational accuracy before production.',
  source: `resources/motion-systems/${folder}; source copy only, not an installed or audited renderer.`
}));
export const editorialTalkingHead: StyleProfile = {
  id: 'editorial-talking-head', category: 'creator', name: 'Talking-head · editorial reel',
  description: 'A speech-led reel with an on-screen presenter, bold keywords, editorial captions and relevant visual inserts.',
  palette: 'Red, white and monochrome accents · adapt to the footage', format: 'Vertical 9:16 by default', duration: 'Follow the spoken story',
  motion: ['Cut mistakes and pauses while preserving meaning and natural delivery.', 'Time readable key words, subtitles, B-roll and split screens to the speech.', 'Use supplied or licensed visuals and review mobile framing and sound.'],
  pieces: ['Source recording', 'Reviewed speech and word timings', 'Reference reels', 'Editable captions', 'Licensed B-roll'],
  promptSuffix: 'Keep the speaker visible when requested, with a clear type hierarchy and original or licensed visuals. Use local tools and verified capabilities.',
  source: 'Supplied talking-head-reels reference; local-first adaptation, not a verified Windows renderer.'
};
export const voiceoverGlass: StyleProfile = {
  id: 'voiceover-glass', category: 'creator', name: 'Voiceover · glass motion reel',
  description: 'Full-screen motion design driven by narration, with glass frames, typography and visual diagrams.',
  palette: 'Dark textured canvas · brand accents · subtle glow', format: 'Match the brief, vertical or landscape', duration: 'Follow the narration',
  motion: ['Do not show presenter footage when the brief calls for voice-only visuals.', 'Use readable kinetic text, rounded glass frames and diagrams to explain each idea.', 'Synchronize keyword changes and optional perspective grid to reviewed speech.'],
  pieces: ['Reviewed narration', 'Storyboard', 'Editable glass layers', 'Original or licensed visual assets', 'Optional quiet sound effects'],
  promptSuffix: 'Use available local tools and user-provided or licensed assets. Higgsfield is optional reference only; do not assume it is connected.',
  source: 'Supplied voiceover-glass-reel reference; local-first adaptation, not its macOS or After Effects pipeline.'
};
export const builtInStyles = [{ ...vox, category: 'study' as const }, ...studyProfiles, ...additionalStudyProfiles, ...[captionReel, creatorVlog, kelsey, saasLaunch, editorialTalkingHead, voiceoverGlass].map(p => ({ ...p, category: 'creator' as const }))];
export function validProfile(value: unknown): value is StyleProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.category === undefined || v.category === 'study' || v.category === 'creator') && ['id', 'name', 'description', 'palette', 'format', 'duration', 'promptSuffix', 'source'].every(k => typeof v[k] === 'string' && (v[k] as string).trim().length > 0) && ['motion', 'pieces'].every(k => Array.isArray(v[k]) && (v[k] as unknown[]).length > 0 && (v[k] as unknown[]).every(x => typeof x === 'string' && x.trim()));
}
export function productionBrief(style: StyleProfile, story: string, beats: string, pieces: string, destination: string) {
  const isVox = style.id === vox.id;
  const workflow = isVox
    ? 'Present 3–5 story beats with on-screen action and title, an itemized piece list, and motion order. Ask for approval before generating paid images or rendering a final film.'
    : style.id === captionReel.id
      ? 'Inspect the footage, final speech and any reference reels. Correct the transcript, verify word onsets against waveform and playback, and make a caption/shot plan. Stack background, behind-subject text, subject matte and foreground text where feasible. Prepare a preview, collect frame-specific notes, revise, and record approved taste decisions before final delivery. Never claim a matte, timing or sound mix is verified without checking it.'
      : style.id === editorialTalkingHead.id || style.id === voiceoverGlass.id
        ? 'Read docs/local-first-reel-workflows.md, inspect the actual audio and references, review the transcript and plan editable visuals and preview frames. Use available local tools and licensed material; do not rely on Higgsfield.'
      : style.id === saasLaunch.id
        ? 'Inspect the supplied reference and product recordings; document rights, evidence and privacy risks. Make a time-coded storyboard and asset plan, build an editable motion-first preview with available tools, review notes, then add synchronized licensed sound and version each render. Follow any user-requested approval checkpoints.'
      : style.id === creatorVlog.id || style.id === kelsey.id
        ? 'Ingest and inspect the supplied footage and references. Plan source clip ranges, speech, captions and visual beats, then build an editable cut and preview with available tools. Review timing, audio and framing before delivery.'
        : style.category === 'study' ? 'Identify learning objectives and verify the supplied source material. Plan concepts, diagrams and complete worked examples, then storyboard and review narration and captions before production.' : 'Present an appropriate story, piece list and motion plan, then review it before final production.';
  return `You are a motion director. Plan an original film using this style profile.\n\nSTYLE: ${style.name}\nSOURCE: ${style.source}\nLOOK: ${style.description}\nPALETTE: ${style.palette}\nFORMAT: ${style.format}; ${style.duration}\n\nSTORY / BRIEF:\n${story.trim() || '[Add the story]'}\n\nBEATS (one per line):\n${beats.trim() || '[Add story beats or key spoken moments]'}\n\nASSETS AND REFERENCES:\n${pieces.trim() || '[Add supplied assets, references, or pieces needed]'}\n\nDESTINATION: ${destination}\n\nMOTION RULES:\n${style.motion.map(x => '- ' + x).join('\n')}\n\nSUGGESTED LAYERS:\n${style.pieces.map(x => '- ' + x).join('\n')}\n\n${isVox ? 'CUT-OUT STYLE LINE (append exactly to each piece prompt when applicable)' : 'STYLE GUIDANCE'}:\n${style.promptSuffix}\n\nWORKFLOW:\n1. ${workflow}\n2. Preserve source references and asset licensing. If a photo is supplied, preserve the real subject's shape, proportions and colors. Use original, licensed or user-supplied assets.\n3. Keep layers and keyframes editable; time entrances and movement to the approved story. Use real readable text for titles if generated lettering is inaccurate.\n4. Use the local resources index and the selected editor's actual capabilities; never claim a connector, render or model is available without checking. Review a preview before delivery.\n\nLOCAL RESOURCE ROUTES: skills/study-video; skills/creator-video; resources/motion-systems; resources/creator-styles/sources; resources/concordia/motion-video-director; resources/concordia/video-motion/design-motion-principles; resources/concordia/video-motion/motionmaxxing; resources/concordia/video-motion/react-three-fiber; resources/concordia/video-motion/drei; resources/concordia/3d/product-layout/CREDITS.md. These are references, not installed integrations.\n`;
}

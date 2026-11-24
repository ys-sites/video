import { brandKitToolArguments } from './brand-kit-tool.ts';
import { transcriptToolArguments, transcriptToolDescription } from './transcript-tool.ts';
import { scenarioToolArguments, scenarioToolDescription } from './scenario-runs.ts';

const id = { type: 'string', pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const object = <T extends Record<string, unknown>>(properties: T, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const reference = object({ assetId: id, versionId: id }, ['assetId', 'versionId']);
export const assetLibraryTool = {
  name: 'openmotion_assets', title: 'OpenMotion · Asset Library',
  description: 'Manage reusable workspace assets independently of film projects. list/get read images, video and audio, immutable versions and generation provenance. import copies a real local file (max 500 MB); generate uses the configured Model Gateway and returns a job, not finished media. First inspect providers/models through openmotion_media_use. Use stable requestId for import/generate/import_to_project, poll the original job with status, and never automatically resubmit a paid request. Project media generation also saves to this library. jobs/status include those new tasks. When savePending is true, retry_save with jobId and a stable requestId saves retained local outputs without another model request. assetId + parentVersionId creates another version; references pin exact versions: image models with supportsImageReference edit with up to maxInputImages references (default one; local Codex and OpenDesign account editing take one), and video models that publish maxInputImages take one first-frame reference. update can rename, move to trash, restore from trash or select a current version; older bytes remain. import_to_project copies a pinned version into an explicit project using its normal import/history protections; it never places it on the timeline. Use resume with the original jobId and a stable requestId to check a failed/interrupted Cloud task or account image task with a known remoteId, without uploading inputs or submitting another paid generation. Cancelled jobs and confirmed remote failures cannot resume. Use retry_save only for retained local outputs (savePending); regeneration is a separate paid request requiring authorization. Studio offers Check original task for Cloud jobs and Continue download for account images. Account image recovery reuses the original prompt/model and remote task; draft edits apply only to a new generation. Partial files resume only with verified asset identity, local checksum and strong ETag; otherwise the same image downloads from zero. Account video/audio recovery is not supported. Reference counts follow the selected model before any reference file is read; there is no fixed library count ceiling. Local Codex/account editing remains one image, video remains one first frame, and project referenceAsset remains image-only. Generated assets, imported project media and composition edits remain separate.',
  inputSchema: object({
    action: { enum: ['list', 'get', 'import', 'update', 'generate', 'jobs', 'status', 'cancel', 'retry_save', 'resume', 'import_to_project'] },
    requestId: { type: 'string', pattern: '^[\\w-]{1,100}$' }, assetId: id, versionId: id, parentVersionId: id, jobId: id,
    projectId: { type: 'string', pattern: '^(project|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$' },
    name: { type: 'string', minLength: 1, maxLength: 200, description: 'Readable display name: preserve meaningful user/source names; for generated, derived or unnamed media use content plus optional purpose, in the project namingLanguage. Supply with generate/import; import_to_project defaults to the saved library name and accepts a name only for explicit renames or missing-name repairs. Keep UUIDs in IDs and the full prompt in prompt.' }, sourcePath: { type: 'string', minLength: 1, maxLength: 4096 },
    modality: { enum: ['image', 'video', 'audio'] }, audioKind: { enum: ['music', 'sfx', 'speech', 'upload'] }, source: { enum: ['upload', 'generated'] }, query: { type: 'string', maxLength: 200 },
    trash: { type: 'boolean' }, sort: { enum: ['newest', 'oldest', 'name'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
    model: { type: 'string', minLength: 1, maxLength: 300 }, prompt: { type: 'string', minLength: 1, maxLength: 20000 },
    mode: { enum: ['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'] }, parameters: { type: 'object', additionalProperties: true },
    references: { type: 'array', items: reference, description: 'Pinned image versions in prompt order. The selected model limits the count: image edits up to its maxInputImages; video models with maxInputImages take one first frame.' }, conversationId: id,
    changes: object({ name: { type: 'string', minLength: 1, maxLength: 200 }, trashed: { type: 'boolean' }, currentVersionId: id }),
  }, ['action']),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const assetUseTool = {
  ...assetLibraryTool, name: 'openmotion_assets_use', title: 'OpenMotion · Assets Use',
  description: 'Preferred Agent route for new media: discover providers and full model IDs through openmotion_media_use inspect/reference/models, then generate, track the original job, inspect fixed versions and import only selected versions into a film project. No carrier project is needed. ' + assetLibraryTool.description + ' action=read requires assetId and versionId and returns bounded image previews, timestamped video frames or a mono 16 kHz WAV audio clip. get remains metadata-only. Read does not generate, create a project or change asset versions; retained trash is readable. Media interpretation/playback depends on the host.',
  inputSchema: { ...assetLibraryTool.inputSchema, properties: { ...assetLibraryTool.inputSchema.properties,
    action: { enum: [...assetLibraryTool.inputSchema.properties.action.enum, 'read'] },
    timestamps: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'number', minimum: 0 }, description: 'read video only: at most four frame times in seconds. Defaults to the first frame.' },
    start: { type: 'number', minimum: 0, description: 'read audio only: clip start in seconds, default 0.' },
    duration: { type: 'number', minimum: 0.1, maximum: 15, description: 'read audio only: clip length in seconds, default 10 (clipped to available audio), maximum 15.' },
  }, oneOf: Object.entries({ list: [], get: ['assetId'], import: ['requestId', 'sourcePath'], update: ['assetId', 'changes'],
    generate: ['requestId', 'model', 'modality', 'prompt'], jobs: [], status: ['jobId'], cancel: ['jobId'], retry_save: ['jobId', 'requestId'], resume: ['jobId', 'requestId'],
    import_to_project: ['projectId', 'requestId', 'assetId', 'versionId'], read: ['assetId', 'versionId'] })
    .map(([action, required]) => ({ type: 'object', properties: { action: { enum: [action] } }, required, additionalProperties: true })),
  },
};
export const workspaceAssetUseTool = {
  ...assetUseTool,
  description: assetUseTool.description + ' Use action=brand_kit with a brandKit command to browse, extract and manage style-only Brand Kits. Use get to read job status and expectedUpdatedAt for package or edits. Brand Kits never determine the film timeline.' + transcriptToolDescription + scenarioToolDescription,
  annotations: { ...assetUseTool.annotations, destructiveHint: true },
  inputSchema: {
    ...assetUseTool.inputSchema, properties: { ...assetUseTool.inputSchema.properties,
      action: { enum: [...assetUseTool.inputSchema.properties.action.enum, 'brand_kit', 'transcript', 'scenario'] }, brandKit: brandKitToolArguments, transcript: transcriptToolArguments, scenario: scenarioToolArguments },
    oneOf: [...assetUseTool.inputSchema.oneOf, ...(['brand_kit', 'transcript', 'scenario'] as const).map(action => ({ type: 'object', properties: { action: { enum: [action] } }, required: [action === 'brand_kit' ? 'brandKit' : action], additionalProperties: true }))],
  },
};

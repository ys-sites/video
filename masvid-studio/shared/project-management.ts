import { reviewCommentProperties, type ReviewCommentsInput } from './review-comments.ts';
export type ProjectManagementInput = ReviewCommentsInput | {
  action: 'info' | 'rename' | 'duplicate' | 'reveal' | 'trash' | 'restore' | 'delete'; projectId: string;
  requestId?: string; title?: string; expectedTitle?: string; expectedRevision?: string;
};
export type ProjectLocation = { projectId: string; title: string; titleKey?: string | null; path: string; platform: string };

export const projectManagementTool = {
  name: 'openmotion_manage_project', title: 'OpenMotion · Manage Project',
  description: 'Review comments: action=comments with operation=list returns complete raw comment records (IDs, text, status, revisions, anchors and annotation vectors) and current sourceRevision. Read original HTML/CSS/JS separately with openmotion_get_project file requests, following file.nextOffset until null; element text is only an excerpt and annotations are not screenshots. create requires text, anchor and expectedRevision from the current saved project. Anchors identify project/frame/element scope, compositionPath, composition-local time and optional element metadata. Frame/element anchors may include annotation with version=1, coordinateSpace=normalized, captured width/height and bounded pen/rectangle/ellipse/arrow/text marks; normalized coordinates refer to the captured frame. update changes text or status=open|resolved; delete removes one comment. Both require commentId and expectedCommentRevision from list. All comment writes require a stable requestId. Comments preserve their original sourceRevision independently of video edits; recheck stale targets before editing. No comment action edits or exports video. Manage an explicit local project without switching the editor. info returns its saved title, absolute directory and server platform. rename requires title, expectedTitle from info and a stable requestId; concurrent name changes fail. duplicate requires a stable requestId, accepts title and expectedRevision, and creates an independent project/session from the current portable source, local assets and Studio edits using the archive validation service. trash moves a project to the recoverable Trash, restore brings it back, and delete permanently removes a project after it has been trashed; all mutations require a stable requestId and return the active project fallback. It excludes credentials, conversations, history and renders and shares ZIP size limits. Retries return the same result. reveal opens the project location in the server machine’s file manager (Finder on macOS); it accepts no arbitrary path. Clipboard copying is a client action using info.path. List projects first with openmotion_get_project; use trashed=true to find restorable projects. Keep at least one project outside Trash.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    ...reviewCommentProperties,
    action: { enum: ['comments', 'info', 'rename', 'duplicate', 'reveal', 'trash', 'restore', 'delete'] },
    projectId: { type: 'string', pattern: '^(project|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$' },
    requestId: { type: 'string', pattern: '^[\\w-]{1,100}$' },
    title: { type: 'string', minLength: 1, maxLength: 100 },
    expectedTitle: { type: 'string', minLength: 1, maxLength: 100 },
    expectedRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  }, required: ['action', 'projectId'] },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};

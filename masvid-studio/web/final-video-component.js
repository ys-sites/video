import { normalizeInlineResult } from '../shared/inline-video-result.js';

/** Only the final-video Tool mounts this surface; production calls never do. */
export function mountFinalVideo(root, app) {
  const document = root.ownerDocument;
  root.innerHTML = '<header><strong class="title">最终视频</strong><span class="duration"></span></header><div class="screen" hidden><video controls playsinline preload="metadata"></video></div><footer><span class="status" role="status" aria-live="polite">正在加载成片…</span><button class="retry" hidden>重新加载</button></footer>';
  const video = root.querySelector('video'), screen = root.querySelector('.screen');
  const status = root.querySelector('.status'), retry = root.querySelector('.retry');
  let identity, work, target, closed = false, loading = false, validSource = false, initialRead = false, url, loadTimer;
  const clearLoadTimer = () => { document.defaultView.clearTimeout(loadTimer); };
  const error = message => {
    clearLoadTimer(); validSource = false; video.pause();
    status.textContent = message; retry.hidden = !(target || work); screen.hidden = true;
  };
  function setInput(input) {
    if (closed) return;
    const args = input?.arguments;
    if (typeof args?.projectId !== 'string' || !args.projectId || typeof args.workId !== 'string' || !args.workId) return;
    const pinned = target || (work && { projectId: work.projectId, workId: work.id });
    if (pinned && (pinned.projectId !== args.projectId || pinned.workId !== args.workId)) {
      error('返回的视频版本不匹配，请重新打开该成片。'); return;
    }
    target = { projectId: args.projectId, workId: args.workId };
    if (!validSource && status.textContent !== '正在加载成片…') retry.hidden = false;
  }
  function update(input, allowDeferred = true) {
    if (closed) return;
    try {
      const result = normalizeInlineResult(input), next = result.structuredContent.inlineWork;
      if (result.isError || !next || next.state !== 'completed' || !next.playable || !next.jobId || !next.sha256)
        throw new Error('成片尚不可播放，请等待导出完成。');
      const key = JSON.stringify([next.projectId, next.id, next.versionId, next.jobId, next.sha256]);
      if (target && (target.projectId !== next.projectId || target.workId !== next.id))
        throw new Error('返回的视频版本不匹配，请重新打开该成片。');
      if (identity && identity !== key) throw new Error('返回的视频版本不匹配，请重新打开该成片。');
      if (identity === key && validSource) return;
      identity = key; work = next;
      root.querySelector('.title').textContent = next.title;
      const media = result._meta?.inlineVideo;
      if (allowDeferred && !media?.video && result.structuredContent.inlineVideoTransport === 'server-tool') {
        if (!initialRead) { initialRead = true; void refresh(); }
        return;
      }
      if (!media?.video) throw new Error('未收到成片文件，请重新加载。');
      if (url) URL.revokeObjectURL(url);
      clearLoadTimer();
      const bytes = Uint8Array.from(atob(media.video.split(',')[1]), c => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      screen.hidden = true; retry.hidden = true; status.textContent = '正在加载成片…';
      video.src = url;
      if (media.poster) video.poster = media.poster;
      validSource = true;
      console.info('openmotion.final_video.media_received', JSON.stringify({ workId: next.id, jobId: next.jobId, bytes: bytes.length }));
      loadTimer = document.defaultView.setTimeout(() => error('视频加载超时，请重新加载。'), 15000);
      video.load();
    } catch (reason) { error(reason.message.startsWith('INLINE_RESULT_INVALID:') ? '成片返回格式异常，请重新加载。' : reason.message); }
  }
  async function refresh() {
    const pinned = target || (work && { projectId: work.projectId, workId: work.id });
    if (!pinned || closed || loading) return;
    loading = true; retry.disabled = true; status.textContent = '正在加载成片…';
    try { update(await app.callServerTool({ name: 'openmotion_get_project', arguments: { ...pinned, includeVideo: true } }, { timeout: 15000 }), false); }
    catch { error('成片读取失败，请重新加载。'); }
    finally { loading = false; retry.disabled = false; }
  }
  const loaded = () => {
    if (closed || !validSource || !Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) return;
    clearLoadTimer();
    screen.hidden = false; status.textContent = '成片可播放'; retry.hidden = true;
    console.info('openmotion.final_video.ready', JSON.stringify({ workId: work.id, jobId: work.jobId, duration: video.duration,
      width: video.videoWidth, height: video.videoHeight }));
    const seconds = Math.round(video.duration);
    root.querySelector('.duration').textContent = `片长 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const failed = () => error('视频播放失败，请重新加载。');
  const visibility = () => { if (document.hidden) video.pause(); };
  video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed);
  document.addEventListener('visibilitychange', visibility); retry.onclick = refresh;
  return { update, setInput, destroy() { closed = true; clearLoadTimer(); video.pause(); video.removeAttribute('src'); video.load();
    if (url) URL.revokeObjectURL(url); document.removeEventListener('visibilitychange', visibility); } };
}

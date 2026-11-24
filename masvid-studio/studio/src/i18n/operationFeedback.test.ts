import { expect, it } from 'vitest';
import { translate } from './I18n';
import { importValidationMessage } from './importMessages';
import { splitFailureMessage } from './editorErrors';
import { systemMessage } from './systemMessages';
import { languages } from './messages';
import { SCRIPT_DEPENDENCY_DELETE_MESSAGE } from '../utils/deleteScriptDependencies';
import { toastErrorMessage } from '../components/ui/toastErrorMessage';

it('localizes late history conflicts without suggesting another attempt', () => {
  for (const key of ['Content has changed. This step cannot be undone.', 'Content has changed. This step cannot be redone.']) {
    expect(toastErrorMessage(key)).toBe(key);
    for (const { locale } of languages) {
      const message = systemMessage(key, (source, values) => translate(locale, source, values));
      if (locale !== 'en') expect(message).not.toBe(key);
    }
  }
  expect(translate('zh-CN', 'Content has changed. This step cannot be undone.')).toBe('内容已变更，无法撤销这一步');
});

it('localizes script dependency deletion refusals in every editor language', () => {
  expect(toastErrorMessage(SCRIPT_DEPENDENCY_DELETE_MESSAGE)).toBe(SCRIPT_DEPENDENCY_DELETE_MESSAGE);
  for (const { locale } of languages) {
    const message = systemMessage(SCRIPT_DEPENDENCY_DELETE_MESSAGE, (key, values) => translate(locale, key, values));
    if (locale === 'en') expect(message).toBe(SCRIPT_DEPENDENCY_DELETE_MESSAGE);
    else expect(message).not.toBe(SCRIPT_DEPENDENCY_DELETE_MESSAGE);
  }
});

it('localizes unavailable timeline media in every interface language', () => {
  expect(translate('zh-CN', 'Media unavailable')).toBe('素材已失效');
  for (const { locale } of languages) {
    if (locale !== 'en') expect(translate(locale, 'Media unavailable')).not.toBe('Media unavailable');
  }
});

it('localizes rejected history restores while preserving project-relative paths', () => {
  const files = 'assets/原始配乐.wav, assets/photo.png';
  const messages = [
    'VERSION_NOT_RESTORABLE: Historical files are missing, unreadable or corrupt: ' + files,
    'VERSION_NOT_RESTORABLE: Cannot stage historical file: ' + files,
  ];
  for (const { locale } of languages) for (const message of messages) {
    const localized = systemMessage(message, (key, values) => translate(locale, key, values));
    expect(localized).toContain(files);
    expect(localized).not.toContain('VERSION_NOT_RESTORABLE');
    expect(localized).not.toMatch(/\{files\}/);
    if (locale === 'zh-CN') expect(localized).toContain('当前项目保持不变');
    if (locale === 'en') expect(localized).toContain('Your current project is unchanged');
  }
});

it('distinguishes invalid media, missing tracks and unavailable validation in both languages', () => {
  const reasons = [
    'ffprobe failed to read the media file', 'no supported video stream found',
    'no supported audio stream found', 'ffprobe returned unreadable media metadata',
    'HYPERFRAMES_FFPROBE_PATH names "/missing", which cannot run: fix it or unset it',
    'not checked: ffprobe was not found. Install FFmpeg or set HYPERFRAMES_FFPROBE_PATH.',
    'unexpected backend details',
  ];
  const zh = reasons.map(reason => importValidationMessage(reason, (m, v) => translate('zh-CN', m, v)));
  const en = reasons.map(reason => importValidationMessage(reason, (m, v) => translate('en', m, v)));
  expect(new Set(zh).size).toBe(reasons.length);
  for (const message of zh) expect(message).not.toMatch(/[A-Za-z]/);
  for (const message of en) expect(message).not.toMatch(/[\u4e00-\u9fff]/);
  expect(zh[5]).toContain('文件已添加');
  expect(zh[0]).toContain('文件完整');
});

it('preserves split failure distinctions without exposing raw server errors', () => {
  const reasons = [
    'Cut conflict: version changed', 'Failed to read index.html before cut (503)',
    'Missing content version for index.html', 'Clip is missing a patchable target.',
    'Cut aborted with rollback conflicts', 'Cut failed: internal server error',
  ];
  const messages = reasons.map(reason => splitFailureMessage(new Error(reason)));
  expect(messages[4]).toContain('could not be rolled back safely');
  expect(messages[0]).toContain('project changed');
  for (const message of messages) {
    expect(translate('zh-CN', message)).not.toBe(message);
    expect(translate('en', message)).toBe(message);
  }
});

it('keeps audio, ripple and remaining audited feedback readable in Chinese and English', () => {
  const messages = [
    ['Use track FX to group audio clips.', '请通过轨道 FX 创建音频分组。'],
    ['Audio clips cannot be grouped with visual elements.', '音频与画面元素不能组合。'],
    ['Gap closed on the main track.', '已收拢主轨空隙。'],
    ['Estimated loudness: −16 LUFS (−3.2 dB).', '调整后预计响度：−16 LUFS（−3.2 dB）。'],
    ['Estimated loudness: −24 LUFS (+12.0 dB); gain limit prevents reaching target.', '调整后预计 −24 LUFS（+12.0 dB），受增益上限限制，未达到目标。'],
    ['Estimated loudness: −18.4 LUFS (+0.0 dB); peak protection prevents reaching target.', '调整后预计 −18.4 LUFS（+0.0 dB），受峰值保护限制，未达到目标。'],
    ['Adjusted 3 clips: 1 expected to reach target; 2 unable to reach target.', '已调整 3 段音频：1 段预计达到目标，2 段未达到目标。'],
    ['Render command copied', '已复制渲染命令'],
    ['Values JSON copied', '已复制变量值 JSON'],
    ['Get the HyperFrames desktop app at https://example.com/app', '可在此下载 HyperFrames 桌面应用：https://example.com/app'],
    ['No longer ducks under the voice.', '已关闭人声避让。'],
  ];
  for (const [source, expected] of messages) {
    expect(systemMessage(source, (key, values) => translate('zh-CN', key, values))).toBe(expected);
    expect(systemMessage(source, (key, values) => translate('en', key, values))).toBe(source);
  }
  for (const shortcut of ['⌘Z', 'Ctrl+Z']) {
    const help = translate('zh-CN', 'Main track magnet: closes gaps after deletion. Undo ({shortcut}) restores the edit; turn this off to keep gaps.', { shortcut });
    expect(help).toContain(shortcut);
    expect(help).toContain('关闭此功能可保留空隙');
  }
});

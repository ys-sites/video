export function renderFilenameStem(title: string | undefined): string {
  const cleaned = (title ?? '').toWellFormed().normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_').trim();
  let stem = '';
  for (const char of cleaned) {
    if (Buffer.byteLength(stem + char, 'utf8') > 200) break;
    stem += char;
  }
  stem = stem.replace(/[. ]+$/u, '') || 'OpenMotion';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem;
}

export function mediaFilename(title: string, extension: string): string {
  const name = title.trim();
  const withoutExtension = extension && name.toLowerCase().endsWith(extension.toLowerCase())
    ? name.slice(0, -extension.length)
    : name;
  const version = withoutExtension.match(/ v[1-9]\d{0,5}$/u)?.[0] ?? '';
  const stem = renderFilenameStem(withoutExtension.slice(0, withoutExtension.length - version.length)).replace(/^\.+/u, '_');
  return stem + version + extension;
}

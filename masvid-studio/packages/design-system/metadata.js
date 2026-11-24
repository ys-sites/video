import { brand, designSystemAsset } from './index.js';

// Product copy only: never derive share metadata from a project, session or local URL.
const copy = {
  en: ['The fullstack agentic video editor. Turn ideas, brand templates and references into editable videos. Generate images, video, music and voiceovers with your AI agent.', 'en_US'],
  'zh-CN': ['全栈 Agent 视频编辑器。把创意、品牌模板和参考视频变成可编辑作品；生成图片、视频、音乐与配音，完成剪辑、动效和动画，从灵感到成片。', 'zh_CN'],
  ja: ['AI エージェントと、アイデア・ブランドテンプレート・参考映像を編集可能な動画へ。画像、動画、音楽、ナレーションの生成から、編集・モーションデザイン・アニメーションまで。', 'ja_JP'],
  ko: ['AI 에이전트와 아이디어, 브랜드 템플릿, 참고 영상을 편집 가능한 영상으로 만드세요. 이미지·영상·음악·내레이션 생성부터 편집, 모션 디자인, 애니메이션까지.', 'ko_KR'],
  de: ['Mit deinem KI-Agenten von Ideen, Markenvorlagen und Referenzen zum editierbaren Video. Bilder, Videos, Musik und Voiceovers erstellen, schneiden und animieren.', 'de_DE'],
  fr: ['Avec votre agent IA, transformez idées, modèles de marque et références en vidéos modifiables. Générez images, vidéos, musique et voix off, puis montez et animez.', 'fr_FR'],
  ru: ['Превращайте идеи, шаблоны брендов и референсы в редактируемые видео вместе с ИИ-агентом. Создавайте изображения, видео, музыку и озвучку, монтируйте и анимируйте.', 'ru_RU'],
  es: ['Convierte ideas, plantillas de marca y referencias en vídeos editables con tu agente de IA. Genera imágenes, vídeo, música y voz en off; edita y anima.', 'es_ES'],
  'pt-BR': ['Transforme ideias, templates de marca e referências em vídeos editáveis com seu agente de IA. Gere imagens, vídeo, música e narração; edite e anime.', 'pt_BR'],
  it: ['Trasforma idee, modelli di brand e riferimenti in video modificabili con il tuo agente IA. Genera immagini, video, musica e voci fuori campo; monta e anima.', 'it_IT'],
  tr: ['Yapay zekâ ajanınızla fikirleri, marka şablonlarını ve referansları düzenlenebilir videolara dönüştürün. Görsel, video, müzik ve seslendirme üretin; kurgulayın ve canlandırın.', 'tr_TR'],
};

// Reuse the public README hero unchanged. Its immutable URL and attribution are
// recorded in repository-media.json and docs/readme/ASSETS.md.
export const socialImage = Object.freeze({
  url: 'https://releases.open-design.ai/open-motion/media/sha256/730e1d6235820d39ba8adde42810d1165377992136a3b20290ad5d504abb527b.jpg',
  width: 1586, height: 992, type: 'image/jpeg',
  alt: 'OpenMotion video recreation: a reference beside its remake, with the editable Studio timeline below.',
});

export function pageMetadata(locale = 'zh-CN') {
  const [description, ogLocale] = copy[locale] ?? copy.en;
  const title = `${brand.website.name} — AI Video & Motion Design`;
  const shareTitle = `${brand.website.name} — Create with your AI agent`;
  return {
    title,
    name: { description, 'application-name': brand.website.name, 'apple-mobile-web-app-title': brand.website.name,
      robots: 'noindex, nofollow', 'color-scheme': 'light dark',
      'twitter:card': 'summary_large_image', 'twitter:title': shareTitle, 'twitter:description': description,
      'twitter:image': socialImage.url, 'twitter:image:alt': socialImage.alt },
    property: { 'og:type': 'website', 'og:site_name': brand.website.name, 'og:title': shareTitle,
      'og:description': description, 'og:locale': ogLocale, 'og:image': socialImage.url,
      'og:image:secure_url': socialImage.url, 'og:image:type': socialImage.type,
      'og:image:width': String(socialImage.width), 'og:image:height': String(socialImage.height), 'og:image:alt': socialImage.alt },
  };
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const faviconLinks = () => [
  `<link rel="icon" type="image/png" sizes="32x32" href="${designSystemAsset('brand/favicon-32.png')}" />`,
  `<link rel="icon" type="image/svg+xml" sizes="any" href="${designSystemAsset(brand.favicon)}?v=2" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="${designSystemAsset('brand/apple-touch-icon.png')}" />`,
].join('\n');

/** Static HTML and the hydrated UI use the same copy, including no-JS startup/errors. */
export function renderPageMetadata(locale = 'zh-CN', surface = 'studio') {
  const meta = pageMetadata(locale);
  if (surface === 'design-system') {
    meta.title = `${brand.website.name} · Design System`;
    meta.name.description = `${brand.website.name} 共享设计系统：颜色、字体、组件、图标与品牌资源。`;
    meta.name['twitter:title'] = meta.property['og:title'] = meta.title;
    meta.name['twitter:description'] = meta.property['og:description'] = meta.name.description;
  }
  return [
    `<title>${escape(meta.title)}</title>`,
    ...['name', 'property'].flatMap(attribute => Object.entries(meta[attribute]).map(([key, value]) =>
      `<meta ${attribute}="${key}" content="${escape(value)}" />`)),
    faviconLinks(),
  ].join('\n');
}

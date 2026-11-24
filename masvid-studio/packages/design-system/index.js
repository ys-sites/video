/** Browser-safe public asset contract. No dependency on Studio or the application server. */
import { providerIconFiles } from './provider-icons.js';
import { platformIconFiles } from './platform-icons.js';
export { platformIcons } from './platform-icons.js';
export { providerIcons, modelBrandId } from './provider-icons.js';
export const designSystemBase = '/design-system';
export const designSystemAsset = (name) => `${designSystemBase}/${name}`;
export const brand = Object.freeze({
  productName: 'Masvid Studio',
  website: Object.freeze({ name: 'Masvid Studio', tagline: 'Your video studio, edited with Claude' }),
  editorName: 'Masvid Studio',
  editorLogo: Object.freeze({ light: 'opendesign-dark.svg', dark: 'opendesign-light.svg' }),
  productLogo: 'brand/openmotion-logo.svg',
  loadingMark: 'brand/loading-mark.svg',
  favicon: 'brand/masvid-favicon.svg',
  communityFeishu: 'brand/community-feishu.svg',
});
export const iconSprite = designSystemAsset('icons.svg');

/** Positive HTTP/distribution list: adding a file to the package does not expose it. */
export const publicDesignFiles = Object.freeze([
  'tokens.json', 'tokens.css', 'ui.css', 'fonts.css', 'base.css', 'controls.css', 'material.css',
  'loading.css', 'studio.css', 'studio/adapter.css', 'studio/control-states.css', 'studio/feedback.css', 'studio/editor-workspace.css', 'studio/application.css', 'studio/primary-navigation.css', 'studio/mcp.css', 'studio/template-cards.css', 'studio/discovery.css', 'studio/media-detail.css', 'studio/audio-assets.css', 'studio/media-quick-actions.css',
  'studio/formFields.css', 'studio/menuPanels.css', 'studio/propertyPanelControls.css', 'studio/disclosure.css',
  'studio/control-recipes.css',
  'index.html', 'theme.js', 'catalog.js', 'catalog-view.js', 'catalog.css', 'token-model.js', 'generate.js', 'icons.svg',
  'opendesign-dark.svg', 'opendesign-light.svg', 'brand/openmotion-logo.svg',
  'brand/loading-mark.svg', 'brand/loading-wordmark.svg', 'brand/favicon.svg', 'brand/favicon-32.png', 'brand/masvid-wordmark.svg', 'brand/masvid-mark.svg', 'brand/masvid-favicon.svg', 'brand/apple-touch-icon.png',
  'brand/community-feishu.svg',
  'fonts/AlbertSans-VariableFont_wght.ttf', 'fonts/IBMPlexMono-Regular.ttf',
  'fonts/Albert-Sans-OFL.txt', 'fonts/IBM-Plex-Mono-OFL.txt', 'fonts/NOTICES.txt',
  'remix-icon-LICENSE.txt', 'remix-icon-NOTICE.txt',
  ...providerIconFiles, 'providers/sources.json', 'providers/NOTICE.md',
  ...platformIconFiles, 'platforms/sources.json', 'platforms/NOTICE.md', 'platforms/CC0-LICENSE.txt', 'platforms/remix-icon-LICENSE.txt',
  'providers/lobe-icons-LICENSE.txt', 'providers/cherry-ui-LICENSE.txt',
]);

export const designSystemDocuments = Object.freeze([
  'packages/design-system/README.md', 'packages/design-system/brand/BRANDKIT.md',
  'packages/design-system/brand/MOTION_DESIGN.md', 'packages/design-system/opendesign-logo-SOURCE.md',
]);

export const designSystemRuntimeFiles = Object.freeze([
  ...publicDesignFiles, 'index.js', 'metadata.js', 'provider-icons.js', 'platform-icons.js', 'package.json', 'tailwind.css', 'inline-feedback.ts',
  'studio/theme.css', 'studio/tokens.css', 'studio/palette-reset.css',
]);

export function resolveDesignSystemFile(pathname) {
  if (pathname === designSystemBase || pathname === `${designSystemBase}/`) return 'index.html';
  const prefix = [`${designSystemBase}/`, '/web/design-system/'].find(value => pathname.startsWith(value));
  if (!prefix) return undefined;
  const file = pathname.slice(prefix.length);
  return publicDesignFiles.includes(file) ? file : undefined;
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { __unstable__loadDesignSystem as loadDesignSystem } from 'tailwindcss';
import { loadStylesheet } from '../studio/src/styles/styleSources.ts';

export type StyleStatus = 'standard' | 'detached' | 'unknown';

function family(property: string) {
  if (/^(?:color|background(?:-color)?|(?:border(?:-[\w-]+)?|outline|caret|accent)-color|fill|stroke)$/.test(property)) return 'color';
  if (/^(?:border(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?|outline)$/.test(property)) return 'color';
  if (property === 'font-size') return 'type size';
  if (/^(?:margin|padding|gap|row-gap|column-gap)(?:-[\w-]+)?$/.test(property)) return 'spacing';
  if (/^border(?:-[\w-]+)?-radius$/.test(property)) return 'radius';
  if (/^(?:text|box)-shadow$/.test(property)) return 'shadow';
}

export function classifyStyle(property: string, value: string, tokens: Set<string>): StyleStatus | undefined {
  const group = family(property);
  if (!group) return;
  if (/^(?:inherit|initial|unset|revert(?:-layer)?|auto|none|transparent|currentcolor|normal|0(?:px|rem|em|%)?)(?:\s+(?:auto|0))*$/i.test(value)) return 'standard';
  // Ignore border widths/styles; only their color decision belongs to this metric.
  if (/^(?:border(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?|outline)$/.test(property)) {
    const color = value.replace(/(?<!\S)(?:\d+(?:\.\d+)?(?:px|em|rem)?|thin|medium|thick|solid|dashed|dotted|double|hidden|none|groove|ridge|inset|outset)(?!\S)/g, '').trim();
    if (!color) return;
    return classifyStyle('color', color, tokens);
  }
  const variables = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]);
  const rest = value.replace(/--[\w-]+/g, '');
  if (/#(?:[\da-f]{3,8})\b|\b(?:rgb[a]?|hsl[a]?|hwb|oklch|oklab|lab|lch|color)\(/i.test(rest)) return 'detached';
  if (/(?:^|[^\w.])(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)(?:px|r?em|pt|ch)\b/i.test(rest)) return 'detached';
  if (variables.some(name => !tokens.has(name))) return 'unknown';
  if (/\b(?:url|image-set)\(/i.test(rest)) return 'unknown';
  if (variables.length) {
    for (const match of value.matchAll(/var\(\s*--[\w-]+\s*,\s*([^()]+?)\s*\)/g)) {
      const fallback = classifyStyle(property, match[1].trim(), tokens);
      if (fallback && fallback !== 'standard') return fallback;
    }
    return 'standard';
  }
  if (group === 'color' && /^[a-z]+$/i.test(value)) return 'detached';
  return 'unknown';
}

export async function styleRules(root: string) {
  const base = path.join(root, 'packages/design-system');
  const tokens = new Set<string>();
  for (const file of ['tokens.css', 'studio/tokens.css', 'material.css']) {
    postcss.parse(readFileSync(path.join(base, file), 'utf8')).walkDecls(/^--/, decl => { tokens.add(decl.prop); });
  }
  const design = await loadDesignSystem('@import "tailwindcss"; @import "./tailwind.css";', { base, loadStylesheet: async (id, from) => loadStylesheet(id, from) });
  const cache = new Map<string, { family: string; status: StyleStatus }[]>();
  function utility(candidate: string) {
    if (cache.has(candidate)) return cache.get(candidate)!;
    const findings = new Map<string, StyleStatus>();
    // Only explicit design utilities count. For example sr-only also emits padding as an implementation detail.
    const eligible = /^!?(?:-?(?:p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|space-[xy])-|(?:rounded|shadow)(?:-|$)|(?:text|bg|border|outline|fill|stroke|caret|accent)-|\[)/.test(candidate);
    const css = eligible && design.candidatesToCss([candidate])[0];
    if (css) {
      const rule = postcss.parse(css).first;
      if (rule?.type === 'rule') {
        rule.walkDecls(decl => {
          const group = family(decl.prop);
          if (!group) return;
          // Named utilities that compile are part of the active theme/scale. Arbitrary values need provenance.
          const arbitrary = candidate.includes('[') || candidate.includes('(');
          let status: StyleStatus | undefined = 'standard';
          if (arbitrary) {
            const shadow = group === 'shadow' && rule.nodes.find(node => node.type === 'decl' && node.prop === '--tw-shadow');
            status = classifyStyle(decl.prop, shadow && shadow.type === 'decl' ? shadow.value : decl.value, tokens);
          } else if (group === 'color' && !classifyStyle(decl.prop, decl.value, tokens)) return;
          if (status && (status === 'detached' || findings.get(group) !== 'detached')) findings.set(group, status);
        });
      }
    }
    const result = [...findings].map(([family, status]) => ({ family, status }));
    cache.set(candidate, result);
    return result;
  }
  return { tokens, utility };
}
export { family as styleFamily };

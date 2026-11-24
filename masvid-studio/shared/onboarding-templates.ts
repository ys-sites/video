// Curated reference pool shared by every onboarding host. Select once per preparation.
export const onboardingTemplateIds = [
  'motion-664184d9-593e-4984-b473-701248b69cfe',
  'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044',
  'motion-0ad92fd0-b2fb-4885-957c-b71152df15fd',
  'motion-a28f0e5d-aa8b-45a7-87f9-9afcac65a09b',
] as const;

export function selectOnboardingTemplateIds(random: () => number = Math.random): string[] {
  const pool: string[] = [...onboardingTemplateIds];
  for (let index = 0; index < 3; index++) {
    const selected = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[selected]] = [pool[selected], pool[index]];
  }
  return pool.slice(0, 3);
}

// Existing clients can still explicitly request the original bundled examples.
export const builtinRecommendationIds = ['product-promo', 'nyt-graph', 'decision-tree'] as const;
export const recommendationTemplateIds = [...builtinRecommendationIds, ...onboardingTemplateIds] as const;

// These small records pin the presentation to its actual catalog/source identity.
// Original reference videos remain at their content-addressed public media URLs.
export const onboardingSourceFiles = onboardingTemplateIds.flatMap(id =>
  ['template.json', 'TEMPLATE.md', 'source/motion.md', 'source/preview.html', 'source/manifest.json']
    .map(file => `library/templates/catalog/${id}/${file}`));

/** What the account page promises about multimodal generation, and the optional campaign shown beside it. */
export const MULTIMODAL_CAPABILITIES = [
  { icon: 'image-line', label: 'Images' },
  { icon: 'film-line', label: 'Video' },
  { icon: 'voiceprint-line', label: 'Voiceover' },
  { icon: 'music-2-line', label: 'Music' },
] as const;

export type AccountOffer = { title: string; detail?: string; startsAt: string; endsAt?: string };

/**
 * The note beside the sign-in and upgrade guides: the lowest price that includes multimodal generation. Plus is the
 * lowest plan with image, video and audio models (Free and Go have none), and its standing annual price is $168 a
 * year, $14 a month billed yearly (open-design.ai/pricing, read 2026-11-21; Pro $840, Max $1,680 a year). No price is delivered to
 * Studio by Prism or AMR, so update this copy in settings-ui.json for every locale when that price changes. A
 * time-limited campaign sets `endsAt`.
 */
export const ACCOUNT_OFFER: AccountOffer | null = {
  title: 'Multimodal from $14/mo',
  startsAt: '2026-11-19T00:00:00Z',
};

export function activeAccountOffer(now = Date.now(), offer = ACCOUNT_OFFER) {
  if (!offer || now < Date.parse(offer.startsAt)) return null;
  return offer.endsAt === undefined || now <= Date.parse(offer.endsAt) ? offer : null;
}

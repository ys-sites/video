import { expect, it } from 'vitest';
import { activeAccountOffer, type AccountOffer } from './accountOffer';

const campaign: AccountOffer = { title: 'Multimodal from $14/mo', detail: 'detail', startsAt: '2026-11-27T00:00:00Z', endsAt: '2026-12-04T23:59:59Z' };

it('shows a campaign only inside its window, including both boundaries', () => {
  expect(activeAccountOffer(Date.parse('2026-11-26T23:59:59Z'), campaign)).toBeNull();
  expect(activeAccountOffer(Date.parse('2026-11-27T00:00:00Z'), campaign)).toBe(campaign);
  expect(activeAccountOffer(Date.parse('2026-12-04T23:59:59Z'), campaign)).toBe(campaign);
  expect(activeAccountOffer(Date.parse('2026-12-05T00:00:00Z'), campaign)).toBeNull();
});

it('keeps a standing offer without an end date and hides a disabled one', () => {
  const standing = { ...campaign, endsAt: undefined };
  expect(activeAccountOffer(Date.parse('2030-01-01T00:00:00Z'), standing)).toBe(standing);
  expect(activeAccountOffer(Date.parse('2026-12-01T00:00:00Z'), null)).toBeNull();
});

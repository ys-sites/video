import { describe, expect, it } from 'vitest';
import { trailerProjectHref } from './GameStudio';

describe('trailerProjectHref', () => {
  it('routes to the canonical /editor/:projectId URL instead of reusing the Game Studio pathname', () => {
    expect(trailerProjectHref('trailer-proj-1', '?game=space-shooter')).toBe(
      '/editor/trailer-proj-1#project/trailer-proj-1',
    );
  });

  it('preserves orthogonal presentation and tracking query params while dropping Game Studio params', () => {
    const trackingId = '11111111-2222-3333-4444-555555555555';
    expect(
      trailerProjectHref(
        'proj with space',
        `?game=space-shooter&embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}`,
      ),
    ).toBe(
      `/editor/proj%20with%20space?embed=1&sidebar=0&conversation=0&tracking_context=${trackingId}#project/proj%20with%20space`,
    );
  });
});

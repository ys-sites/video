import { expect, it } from 'vitest';
import type { GalleryTemplate } from '../../../shared/catalog';
import { templateCredit, templateCreators } from './templateCredits';

function work(metadata: Partial<GalleryTemplate>): GalleryTemplate {
  return { id: 'work', title: 'Work', tags: [], ...metadata } as GalleryTemplate;
}

it('separates catalogue authors, original post publishers and unattributed brands', () => {
  const credit = work({ authorName: ' Ana ', sourceUrl: 'https://x.com/brand/status/1' });
  const post = work({ sourceUrl: 'https://twitter.com/StudioWorks/status/2' });
  const second = work({ sourceUrl: 'https://x.com/studioworks/status/3?s=20' });
  expect(templateCredit(credit)?.id).toBe('credit/Ana');
  expect(templateCreators([credit, post, second, work({ brand: 'Brand' })], 'en').map(c => [c.id, c.count]))
    .toEqual([['x/studioworks', 2], ['credit/Ana', 1]]);
  for (const url of ['https://x.com/i/status/123', 'https://x.com/artist', 'https://x.com.example.org/artist/status/2', '/artist/status/1']) {
    expect(templateCredit(work({ sourceUrl: url }))).toBeUndefined();
  }
});

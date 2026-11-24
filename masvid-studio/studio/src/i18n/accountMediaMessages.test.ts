import { expect, it } from 'vitest';
import { accountMediaMessages, accountSignInMessages } from '../../../gateway/account.ts';
import { isKnownMessage } from './messages';

// The failure card translates gateway errors by exact text, so a reworded gateway message would silently stay English.
it('has a Chinese translation for every account media failure the gateway reports', () => {
  expect(accountMediaMessages.length).toBeGreaterThan(10);
  expect(accountMediaMessages.filter(message => !isKnownMessage(message))).toEqual([]);
});

it('has a Chinese translation for every sign-in failure the account panel shows', () => {
  expect(accountSignInMessages.length).toBeGreaterThan(5);
  expect(accountSignInMessages.filter(message => !isKnownMessage(message))).toEqual([]);
});

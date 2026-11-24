// @vitest-environment node
import { expect, it } from 'vitest';
import { apiUrlError, defaultParameters } from './settingsValidation';
import { connectionBaseUrl } from '../../../gateway/connections';
import { providerOrigin } from '../../../gateway/network';
import { modelMetadata } from '../../../gateway/model-metadata';

it.each([
  '', 'not a url', 'http://api.example.com', 'https://api.example.com/v1',
  'https://api.example.com:443/v2/', 'https://api.example.com:8443',
  'https://user:pass@api.example.com', 'https://api.example.com/?key=x', 'https://api.example.com/#section',
  'https://api.example.com/a%2fb', 'https://api.example.com/a%5Cb',
  'https://localhost', 'https://foo.localhost', 'https://127.1', 'https://0x7f000001',
  'https://10.1.2.3', 'https://172.16.0.1', 'https://172.32.0.1', 'https://192.168.1.1',
  'https://100.64.0.1', 'https://169.254.0.1', 'https://224.0.0.1', 'https://8.8.8.8',
  'https://[::1]', 'https://[::ffff:8.8.8.8]', 'https://[2001:4860:4860::8888]',
  `https://api.example.com/${'a'.repeat(2048)}`,
])('matches service API URL acceptance: %s', value => {
  let accepted = true;
  try { connectionBaseUrl(value); } catch { accepted = false; }
  expect(!apiUrlError(value)).toBe(accepted);
});
it.each(['https://api.example.com', 'https://api.example.com/v1', 'https://api.example.com/v1/', 'https://api.example.com/v2'])('matches gateway origin path rules: %s', value => {
  let accepted = true;
  try { providerOrigin(value); } catch { accepted = false; }
  expect(!apiUrlError(value, true)).toBe(accepted);
});
it.each(['model', 'MODEL', 'prompt', 'input', 'api_key', 'api-key', 'apiKey', 'authorization', 'headers', 'webhook_url', '__proto__', 'constructor', 'prototype'])('matches reserved JSON field validation: %s', field => {
  const raw = `{"${field}":"test"}`, result = defaultParameters(raw);
  expect(result.field).toBe(field);
  expect(result.error).toBeTruthy();
  expect(() => modelMetadata({ defaults: JSON.parse(raw) })).toThrow('reserved field');
});
it('allows nested names and JSON whitespace while matching serialized size boundaries', () => {
  for (const parameters of [{ nested: { model: 'allowed' } }, { text: '中'.repeat(63989) }]) {
    const result = defaultParameters(JSON.stringify(parameters, null, 2));
    expect(result.error).toBeUndefined();
    expect(() => modelMetadata({ defaults: result.parameters })).not.toThrow();
  }
  const result = defaultParameters(JSON.stringify({ text: '中'.repeat(63990) }));
  expect(result.error).toContain('64,000');
  expect(() => modelMetadata({ defaults: result.parameters })).toThrow();
});

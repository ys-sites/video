/** UI preflight only; the service remains authoritative for settings validation. */
export function modelIdError(value: string): string | undefined {
  if (!value.trim()) return 'Enter a model ID.';
  if (value.trim().length > 180) return 'Model ID cannot exceed 180 characters.';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,179}$/.test(value.trim())) return 'Start with a letter or number. Use only letters, numbers, dots, underscores, slashes, colons or hyphens.';
}
export function providerNameError(value: string): string | undefined {
  if (!value.trim()) return 'Enter a provider name.';
  if (value.length > 80) return 'Provider name cannot exceed 80 characters.';
}
export function apiKeyError(value: string): string | undefined {
  if (value.trim().length > 4096 || /[\x00-\x1f]/.test(value.trim())) return 'API key cannot exceed 4,096 characters or contain control characters.';
}
export function apiUrlError(value: string, originOnly = false): string | undefined {
  if (!value.trim()) return 'Enter an API base URL.';
  if (value.length > 2048) return 'API URL cannot exceed 2,048 characters.';
  let url: URL;
  try { url = new URL(value); } catch { return 'Enter a valid HTTPS API URL.'; }
  if (url.protocol !== 'https:') return 'Use an HTTPS API URL.';
  if (url.username || url.password || url.search || url.hash) return 'Remove credentials, query parameters and fragments from the API URL.';
  if (/%2f|%5c/i.test(url.pathname)) return 'Remove encoded slashes and backslashes from the API URL path.';
  if (originOnly && !['', '/', '/v1', '/v1/'].includes(url.pathname)) return 'Use the API origin with no path, or with /v1 only.';
  if (url.port && url.port !== '443') return 'Use the default HTTPS port (443).';
  const host = url.hostname;
  // URL normalizes IPv4 shorthand, hexadecimal and IPv6 before this check.
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const [a, b] = host.split('.').map(Number);
  if (host === 'localhost' || host.endsWith('.localhost')
    || ipv4 && (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127)
    || host.startsWith('[') && !/^\[[23][0-9a-f]{3}:/i.test(host)) return 'Use a public API address, not a local or private address.';
}
export function defaultParameters(value: string): { parameters: Record<string, unknown> | null; error?: string; field?: string } {
  let parameters: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { parameters: null, error: 'Enter a valid JSON object.' };
    parameters = parsed as Record<string, unknown>;
  } catch { return { parameters: null, error: 'Enter a valid JSON object.' }; }
  if (JSON.stringify(parameters).length > 64000) return { parameters, error: 'Default parameters cannot exceed 64,000 characters after JSON formatting is removed.' };
  const field = Object.keys(parameters).find(key => /^(?:model|prompt|input|api[_-]?key|authorization|headers|webhook_url|__proto__|constructor|prototype)$/i.test(key));
  return { parameters, ...(field ? { error: 'Remove the reserved field “{field}” from default parameters.', field } : {}) };
}

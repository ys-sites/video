// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsSurfaceBoundary } from './SettingsSurfaceBoundary';
vi.mock('./diagnostics', () => ({ recordBrowserDiagnostic: vi.fn() }));

it('contains a settings render failure without discarding the mounted editor and allows retry', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), dispose = vi.fn(); let fail = true;
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  function Editor() { useEffect(() => dispose, []); return <input defaultValue="staged edit" />; }
  function Settings() { if (fail) throw new Error('Settings failed'); return <div>Recovered settings</div>; }
  try {
    await act(async () => root.render(<><Editor /><SettingsSurfaceBoundary><Settings /></SettingsSurfaceBoundary></>));
    const editor = host.querySelector('input');
    expect(editor?.value).toBe('staged edit');
    expect(host.querySelector('[role=alert]')).toBeTruthy();
    expect(dispose).not.toHaveBeenCalled();
    fail = false;
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('Recovered settings');
    expect(host.querySelector('input')).toBe(editor);
    expect(dispose).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); host.remove(); logging.mockRestore(); }
});

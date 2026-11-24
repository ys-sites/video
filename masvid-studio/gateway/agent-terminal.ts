import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAgent } from './agents.ts';

export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const powershellQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
export function terminalCommand(bin: string, args: string[], cwd: string, platform = process.platform): string {
  if (platform === 'win32') return `Set-Location -LiteralPath ${powershellQuote(cwd)}\n& ${[bin, ...args].map(powershellQuote).join(' ')}`;
  return `cd ${shellQuote(cwd)} && ${[bin, ...args].map(shellQuote).join(' ')}`;
}
export async function launchTerminal(dataDirectory: string, command: string): Promise<void> {
  const run = (bin: string, args: string[]) => new Promise<void>((resolve, reject) => execFile(bin, args, { timeout: 8000, windowsHide: true }, error => error ? reject(new Error('Could not open a terminal. Copy the command and run it in your terminal.')) : resolve()));
  if (process.platform === 'win32') {
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -ArgumentList '-NoProfile','-NoExit','-EncodedCommand','${encoded}'`]);
    return;
  }
  const root = path.join(dataDirectory, 'agents', 'launches'); await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${randomUUID()}.command`);
  // The file contains no credentials and removes itself when the terminal starts.
  await writeFile(file, `#!/bin/sh\nrm -f -- "$0"\n${command}\nprintf '\\nPress Enter to close…'\nread answer\n`, { mode: 0o700 });
  if (process.platform === 'darwin') await run('/usr/bin/open', ['-a', 'Terminal', file]);
  else {
    const terminal = await resolveAgent('x-terminal-emulator') ?? await resolveAgent('xterm');
    if (!terminal) throw new Error('No desktop terminal found. Copy the command and run it in your terminal.');
    // Terminal emulators stay alive with the child; detach after a successful spawn.
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => { const child = spawn(terminal, ['-e', file], { detached: true, stdio: 'ignore' }); child.once('error', () => reject(new Error('Could not open a terminal'))); child.once('spawn', () => { child.unref(); resolve(); }); });
  }
}

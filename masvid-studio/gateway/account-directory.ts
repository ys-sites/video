import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The per-user OpenDesign account directory. Every workspace on this computer signs in once here, so a Studio opened on
 * its own and an Agent host started with another `MOTION_DATA_DIR`, installation or channel see the same account.
 */
export function sharedAccountDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const base = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    : env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share');
  return join(base, 'OpenDesign', 'account');
}

/** Resolves links and Windows short names through the nearest existing ancestor, since a workspace may not exist yet. */
function real(directory: string): string {
  const resolved = path.resolve(directory);
  try { return realpathSync.native(resolved); } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(real(parent), path.basename(resolved));
  }
}
const inside = (child: string, parent: string) => { const relative = path.relative(parent, child); return !relative.startsWith('..') && !path.isAbsolute(relative); };
/** Temporary workspaces (tests, isolated previews) never pick up or change the person's sign-in. */
function temporary(directory: string) {
  const roots = [path.resolve(os.tmpdir()), real(os.tmpdir())];
  return [path.resolve(directory), real(directory)].some(candidate => roots.some(root => inside(candidate, root)));
}

/** Account credentials, session and model catalogue for a workspace. `MOTION_ACCOUNT_DIR` selects another directory. */
export function accountDirectory(dataDirectory: string, env = process.env) {
  if (env.MOTION_ACCOUNT_DIR) return path.resolve(env.MOTION_ACCOUNT_DIR);
  return temporary(dataDirectory) ? path.join(path.resolve(dataDirectory), 'account') : sharedAccountDirectory(process.platform, env);
}

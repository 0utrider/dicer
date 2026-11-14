// Vite config for the fx review scripts: the repo config plus a cacheDir under the git-ignored
// artifacts/ and preserveSymlinks, so dev pre-bundling and the Rapier glue module ids still match
// when node_modules is a symlink (a git worktree). A plain checkout is unaffected.
import { mergeConfig } from 'vite';
import base from '../../vite.config.js';

export default mergeConfig(base, {
  cacheDir: 'artifacts/.vite-fx',
  resolve: { preserveSymlinks: true },
});

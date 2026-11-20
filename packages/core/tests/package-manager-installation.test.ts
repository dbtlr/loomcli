import { packageManagerInstallation } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

const globalInstallations = [
  { layout: 'Cellar/notes-cli/1.5.0/libexec/lib/node_modules/@acme/notes/cli.js', method: 'brew' },
  { layout: 'prefix/lib/node_modules/cowsay/cli.js', method: 'npm' },
  { layout: 'prefix/lib/node_modules/@acme/notes/cli.js', method: 'npm' },
  { layout: 'pnpm/global/5/.pnpm/cowsay@1.6.0/node_modules/cowsay/cli.js', method: 'pnpm' },
  {
    layout: 'pnpm/global/5/.pnpm/@acme+notes@1.6.0/node_modules/@acme/notes/cli.js',
    method: 'pnpm',
  },
  { layout: 'pnpm/store/v11/links/@/cowsay/1.6.0/hash/node_modules/cowsay/cli.js', method: 'pnpm' },
  {
    layout: 'custom-store/v11/links/@acme/notes/1.6.0/hash/node_modules/@acme/notes/cli.js',
    method: 'pnpm',
  },
  { layout: '.bun/install/global/node_modules/cowsay/cli.js', method: 'bun' },
  { layout: '.bun/install/global/node_modules/@acme/notes/cli.js', method: 'bun' },
  { layout: '.config/yarn/global/node_modules/cowsay/cli.js', method: 'yarn' },
  { layout: 'data/yarn/global/node_modules/@acme/notes/cli.js', method: 'yarn' },
];

/*
 * The binary an npm launcher package starts from its platform package, at the realpath each global
 * install leaves, under ADR-0213's installation method and ADR-0211's global roots. pnpm resolves the
 * platform package into a folder of its own in the store; npm nests it below the launcher; Bun and
 * Yarn 1 hoist it beside the launcher in the global folder.
 */
const platformBinaries = [
  {
    layout: 'prefix/lib/node_modules/@acme/notes/node_modules/@acme/notes-linux-x64/bin/notes',
    method: 'npm',
  },
  {
    layout: 'pnpm/global/5/.pnpm/notes-linux-x64@1.6.0/node_modules/notes-linux-x64/bin/notes',
    method: 'pnpm',
  },
  {
    layout:
      'pnpm/global/5/.pnpm/@acme+notes-darwin-arm64@1.6.0/node_modules/@acme/notes-darwin-arm64/bin/notes',
    method: 'pnpm',
  },
  {
    layout:
      'pnpm/store/v11/links/@/notes-linux-x64/1.6.0/hash/node_modules/notes-linux-x64/bin/notes',
    method: 'pnpm',
  },
  {
    layout:
      'pnpm/store/v11/links/@acme/notes-linux-arm64-musl/1.6.0/hash/node_modules/@acme/notes-linux-arm64-musl/bin/notes',
    method: 'pnpm',
  },
  { layout: '.bun/install/global/node_modules/notes-linux-x64/bin/notes', method: 'bun' },
  { layout: '.bun/install/global/node_modules/@acme/notes-darwin-arm64/bin/notes', method: 'bun' },
  { layout: '.config/yarn/global/node_modules/notes-linux-x64/bin/notes', method: 'yarn' },
  { layout: 'data/yarn/global/node_modules/@acme/notes-linux-x64-musl/bin/notes', method: 'yarn' },
];

test.each([...globalInstallations, ...platformBinaries])(
  '$layout identifies $method on Linux and macOS',
  ({ layout, method }) => {
    const extra = method === 'brew' ? { formula: 'notes-cli' } : {};
    const linux = `/home/me/${layout}`;
    const macOS = `/Users/me/${layout}`;
    expect(packageManagerInstallation(linux, 'linux')).toEqual({ ...extra, method, path: linux });
    expect(packageManagerInstallation(macOS, 'darwin')).toEqual({ ...extra, method, path: macOS });
    expect(packageManagerInstallation(macOS, 'win32')).toBeUndefined();
  },
);

test.each([
  'project/node_modules/@acme/notes/cli.js',
  'project/node_modules/.pnpm/cowsay@1.6.0/node_modules/cowsay/cli.js',
  '.npm/_npx/hash/node_modules/cowsay/cli.js',
  'cache/dlx/hash/id/node_modules/.pnpm/cowsay@1.6.0/node_modules/cowsay/cli.js',
  '.bun/install/cache/cowsay@1.6.0/cli.js',
  'pnpm/global/v11/hash/node_modules/cowsay/cli.js',
  'pnpm/global/5/node_modules/cowsay/cli.js',
  'pnpm/global/v5/.pnpm/cowsay@1.6.0/node_modules/cowsay/cli.js',
  'pnpm/store/11/links/@/cowsay/1.6.0/hash/node_modules/cowsay/cli.js',
  'pnpm/store/v11/links/cowsay/1.6.0/hash/node_modules/cowsay/cli.js',
  'pnpm/store/v11/links-old/@/cowsay/1.6.0/hash/node_modules/cowsay/cli.js',
  '.bun/reinstall/global/node_modules/cowsay/cli.js',
  '.config/not-yarn/global/node_modules/cowsay/cli.js',
])('%s gives no package-manager installation', (layout) => {
  expect(packageManagerInstallation(`/home/me/${layout}`, 'linux')).toBeUndefined();
});

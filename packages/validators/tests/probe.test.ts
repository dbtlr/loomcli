import { expect, test } from 'vite-plus/test';

import { holds } from '../src/probe.js';

/** A probe that fails the way the filesystem does, with an error carrying `code`. */
function failing(code: string) {
  return async () => {
    throw Object.assign(new Error(`${code}: probe failed`), { code });
  };
}

test.each(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG', 'EINVAL'])(
  'a probe failing with %s is a verdict about the token',
  async (code) => {
    await expect(holds(failing(code))).resolves.toBe(false);
  },
);

test('a probe failing any other way throws, so core reports a validator failure', async () => {
  await expect(holds(failing('EIO'))).rejects.toThrow('EIO: probe failed');
});

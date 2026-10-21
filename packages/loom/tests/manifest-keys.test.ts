import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { readParticipants } from '../src/helpers/repository.js';
import { removeRoots, temporaryRoot } from './fixture.js';

afterEach(() => {
  removeRoots();
});

test('a participant keeps a dependency named constructor and one named prototype', () => {
  const root = temporaryRoot('loom-keys-');
  mkdirSync(join(root, 'packages/core'), { recursive: true });
  writeFileSync(
    join(root, 'packages/core/package.json'),
    JSON.stringify({
      dependencies: { constructor: '^1.0.0' },
      name: '@sample/core',
      peerDependencies: { prototype: '^2.0.0' },
      version: '0.1.0',
    }),
  );
  const [participant] = readParticipants(root);
  expect(participant?.manifest.dependencies).toEqual({ constructor: '^1.0.0' });
  expect(participant?.manifest.peerDependencies).toEqual({ prototype: '^2.0.0' });
});

test('a participant with dependencies that are not strings names each dependency', () => {
  const root = temporaryRoot('loom-keys-');
  mkdirSync(join(root, 'packages/core'), { recursive: true });
  writeFileSync(
    join(root, 'packages/core/package.json'),
    JSON.stringify({
      dependencies: { left: 1, middle: '^1.0.0', right: true },
      name: '@sample/core',
      version: '0.1.0',
    }),
  );
  expect(() => readParticipants(root)).toThrow(
    'dependencies.left: Invalid type: Expected string but received 1\n' +
      'dependencies.right: Invalid type: Expected string but received true',
  );
});

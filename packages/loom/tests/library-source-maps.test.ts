import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/library-source-maps.mjs', import.meta.url);
const packages = new URL('../../', import.meta.url);

test.each([
  {
    code: 'throw new FatalError',
    frame: /manpage\/children\.ts:(?<line>\d+):\d+/u,
    scenario: 'action',
    source: 'plugins/src/manpage/children.ts',
  },
  {
    code: 'throw new DeclarationError',
    frame: /inputs\/validation\.ts:(?<line>\d+):\d+/u,
    scenario: 'validation',
    source: 'core/src/inputs/validation.ts',
  },
])(
  'Node maps a published $scenario frame to the TypeScript throw',
  ({ code, frame, scenario, source }) => {
    const result = invoke(fixture, [scenario], {
      env: { NODE_OPTIONS: '--enable-source-maps' },
      runtime: 'node',
    });

    expect(result.status).toBe(0);
    const mapped = frame.exec(result.stdout);
    expect(
      mapped,
      `Expected a stack frame matching ${frame}. Actual stack:\n${result.stdout}`,
    ).not.toBeNull();
    const lines = readFileSync(new URL(source, packages), 'utf8').split('\n');
    expect(lines[Number(mapped?.groups?.line) - 1]).toContain(code);
  },
);

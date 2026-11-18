// @module-tag docs
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';

test('skill assertion sentences keep the message voice', async () => {
  await expect(
    voiceReport(
      new URL('../src/', import.meta.url),
      {
        'outside-text': {
          'assert-assembles.ts': {
            'fault.message': {
              reason: 'The assembly assertion relays each Developer Diagnostic.',
              sites: 1,
            },
          },
        },
      },
      { classes: ['Error'] },
    ),
  ).resolves.toEqual([]);
});

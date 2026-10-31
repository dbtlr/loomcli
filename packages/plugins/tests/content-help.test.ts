import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { help } from '../src/help/plugin.js';
import { manPages } from '../src/manpage/page.js';

test.each([
  [0, 'min: 0 sources, max: 0 sources'],
  [1, 'min: 1 source, max: 1 source'],
  [2, 'min: 2 sources, max: 2 sources'],
])(
  'help and man pages name a content bound of %s with the right source noun',
  async (bound, facts) => {
    const app = new Application('count', { description: 'Count sources.', plugins: [help()] })
      .argument('files', {
        description: 'The files.',
        max: bound,
        min: bound,
        type: 'content',
        variadic: true,
      })
      .option('extra', {
        description: 'The additional files.',
        max: bound,
        min: bound,
        multiple: true,
        type: 'content',
      })
      .action(() => undefined);
    const outcome = await app.invoke([], { options: { help: true } }, { process: mockProcess() });
    if (outcome.status !== 'completed') {
      throw new Error('Expected the help takeover to complete.');
    }
    expect(outcome.output).toContain(`The files.  (file path, ${facts})`);
    expect(outcome.output).toContain(`The additional files.  (file path, ${facts},`);
    const [page] = manPages(app.inspect());
    expect(page?.text).toContain(`The files.  (file path, ${facts})`);
    expect(page?.text).toContain(`The additional files.  (file path, ${facts},`);
  },
);

import { Application, readExtension, style } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { theme } from '@loomcli/plugins/theme';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';
import { renderingInput } from './rendering-input.js';

async function run(args: string[] = []) {
  const input = z
    .object({
      argv: z.array(z.string()).optional(),
      details: z.string(),
      inspect: z.boolean().optional(),
      rendering: renderingInput.optional(),
      themed: z.boolean().optional(),
    })
    .parse(JSON.parse(args[0] ?? '{}'));

  const plugins: Plugin[] = [help(), manifest()];
  if (input.themed) {
    plugins.push(theme({ dim: style.magenta, highlight: style.cyan, primary: style.green }));
  }
  const app = new Application('app', { plugins })
    .extend(helpCommand({ details: input.details }))
    .action(() => {});
  if (input.inspect) {
    const value = readExtension(app.inspect().root, manifestCommand);
    return { stdout: `${JSON.stringify(value)}\n` };
  }
  return await runOnMock(
    app,
    { argv: input.argv ?? ['--help'] },
    {
      rendering: input.rendering ?? { color: 'never', modifiers: 'never' },
    },
  );
}
export { run };

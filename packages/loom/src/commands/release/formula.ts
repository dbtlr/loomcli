import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ActionHandler } from '@loomcli/core';

import { packageDirectory } from '../../helpers/package-directory.js';
import { renderReleaseFormula } from '../../helpers/release-formula.js';
import { report } from '../../helpers/report.js';
import type { releaseFormula } from './command.js';
import { wroteFormula } from './messages.js';

export const writeReleaseFormula: ActionHandler<typeof releaseFormula> = async ({
  host,
  options,
  out,
  provided,
  signal,
}) => {
  await report({ out, signal }, () => {
    const { checksums, name, output } = options;
    const manifest = join(packageDirectory(host.cwd), 'package.json');
    const formula = renderReleaseFormula({
      checksums: { path: checksums, text: readFileSync(resolve(host.cwd, checksums), 'utf8') },
      manifest: { path: manifest, text: readFileSync(manifest, 'utf8') },
      name: name ?? provided.config.name,
      output,
    });
    const target = resolve(host.cwd, output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, formula);
    return wroteFormula(output);
  });
};

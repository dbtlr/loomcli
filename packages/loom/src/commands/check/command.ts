import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from '@loomcli/core';

import { checkApplication } from '../../helpers/application-check.js';
import { driftWarning, hasDrifted, managedFiles, readManaged } from '../../helpers/managed.js';
import { existingModule, shown } from '../../helpers/modules.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';
import { typePass } from '../../helpers/type-pass.js';

/** One warning line for each managed file in the package whose content drifted from its header. */
function driftWarnings(directory: string): string[] {
  return managedFiles.flatMap((path) => {
    const absolute = join(directory, path);
    const file = existsSync(absolute) ? readManaged(readFileSync(absolute, 'utf8')) : undefined;
    return file !== undefined && hasDrifted(file) ? [driftWarning(path)] : [];
  });
}

/**
 * Every finding of one check, in the order it prints: the type pass's report or its note, what the
 * module wrote while it loaded, each fault's Developer Diagnostic, and the drift warnings, one
 * blank line between blocks. A drift warning never fails the check.
 */
function runCheck(cwd: string, option: string | undefined) {
  const directory = packageDirectory(cwd);
  const path = existingModule(
    cwd,
    option === undefined ? join(directory, 'src/application.ts') : resolve(cwd, option),
    'application',
  );
  const types = typePass(directory);
  const { result, written } = checkApplication({ directory, module: shown(cwd, path), path });
  const faults = 'faults' in result ? result.faults : [result.failure];
  const warnings = driftWarnings(directory);
  const blocks = [
    types.kind === 'skipped' ? types.note : types.report,
    written,
    ...faults,
    warnings.join('\n'),
  ].filter((block) => block !== '');
  return {
    failed: (types.kind === 'ran' && types.failed) || faults.length > 0,
    text: blocks.join('\n\n'),
  };
}

export const checkCommand = new Command('check', {
  description: "Report every fault the package's application and code hold before anything runs.",
})
  .option('application', {
    description: 'Check this module, which exports the Application, instead of src/application.ts.',
    type: 'string',
  })
  .action(async ({ host, options, out, passthrough }) => {
    await report(out, passthrough, () => {
      const outcome = runCheck(host.cwd, options.application);
      if (outcome.failed) {
        throw new Error(outcome.text);
      }
      if (outcome.text !== '') {
        host.stderr.write(`${outcome.text}\n`);
      }
      return '';
    });
  });

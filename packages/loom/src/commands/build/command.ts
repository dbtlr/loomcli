import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command, InputError } from '@loomcli/core';
import { z } from 'zod';

import {
  applicationName,
  buildFacts,
  definePair,
  ownerName,
  readManifest,
} from '../../helpers/build-facts.js';
import { hostTarget, isWindows, targetOption } from '../../helpers/build-target.js';
import type { BuildTarget } from '../../helpers/build-target.js';
import { build, watch } from '../../helpers/build.js';
import { existingModule, shown } from '../../helpers/modules.js';
import { packageDirectory } from '../../helpers/package-directory.js';
import { report } from '../../helpers/report.js';

const buildOption = z.enum(['development', 'distributed'], {
  error: 'Use development or distributed.',
});

const repositoryOption = z.string().regex(ownerName, 'Use owner/name, such as acme/notes.');

/** The option error one option draws from another it cannot be passed with, with exit code 2. */
function optionError(name: string, message: string): InputError {
  return new InputError(`Option "--${name}": ${message}`, [
    {
      input: { global: false, kind: 'option', name },
      issues: [{ message }],
      reason: 'invalid',
      spelling: `--${name}`,
    },
  ]);
}

/**
 * The application module a bundle carries beside the entry: the one `--application` names, which
 * must exist, else `src/application.ts` when it exists. A binary compiles the entry alone.
 */
function applicationModule(
  paths: { cwd: string; directory: string },
  target: BuildTarget,
  option: string | undefined,
): string | undefined {
  if (target.kind === 'compile') {
    return undefined;
  }
  if (option !== undefined) {
    return existingModule(paths.cwd, resolve(paths.cwd, option), 'application');
  }
  const conventional = join(paths.directory, 'src/application.ts');
  return existsSync(conventional) ? conventional : undefined;
}

/**
 * Where a build writes when `--out` names nothing: a bundle's directory, `dist/`, or a binary's
 * file, `dist/<name>`, with `.exe` for a Windows target.
 */
function defaultOutput(directory: string, target: BuildTarget, name: () => string): string {
  if (target.kind === 'bundle') {
    return join(directory, 'dist');
  }
  return join(directory, 'dist', `${name()}${isWindows(target) ? '.exe' : ''}`);
}

export const buildCommand = new Command('build', {
  description: "Build the package's application for one target with its release facts baked in.",
})
  .option('target', {
    description:
      'Build for node, bun, or a Bun compile target, by default the host compile target.',
    type: 'string',
    validate: targetOption,
  })
  .option('out', {
    description:
      "Write to this path: a bundle's directory, by default dist/, or a binary's file, by default dist/<name>.",
    type: 'string',
  })
  .option('entry', {
    description: 'Build from this module, which calls run(), instead of src/main.ts.',
    type: 'string',
  })
  .option('application', {
    description:
      'Bundle this module, which exports the Application, instead of src/application.ts.',
    type: 'string',
  })
  .option('build', {
    description: 'Bake this build into the artifact instead of distributed.',
    type: 'string',
    validate: buildOption,
  })
  .option('watch', {
    description: 'Rebuild a development artifact on each change until stopped.',
    type: 'boolean',
  })
  .option('release', {
    description: "Bake the release group from package.json's version and repository.",
    type: 'boolean',
  })
  .option('repository', {
    description: 'Name the release repository as owner/name instead of the repository field.',
    type: 'string',
    validate: repositoryOption,
  })
  .option('name', {
    description: "Name the application for a binary's path and asset instead of package.json bin.",
    type: 'string',
  })
  .option('facts', {
    description: 'Print the release facts JSON and build nothing.',
    type: 'boolean',
  })
  .option('define', {
    description: 'Print the define pair __LOOM_RELEASE__=<json> and build nothing.',
    type: 'boolean',
  })
  .action(async ({ host, options, out, passthrough }) => {
    if (options.facts && options.define) {
      throw optionError('define', '--facts and --define exclude each other, so pass one of them.');
    }
    if (options.watch && options.build === 'distributed') {
      throw optionError(
        'build',
        '--watch builds development, so pass --watch or --build distributed.',
      );
    }
    await report(out, passthrough, async () => {
      const { cwd } = host;
      const directory = packageDirectory(cwd);
      const manifest = readManifest(directory);
      const target = options.target ?? hostTarget();
      const facts = buildFacts({
        build: options.build ?? (options.watch ? 'development' : 'distributed'),
        manifest,
        name: options.name,
        release: options.release ? { repository: options.repository } : undefined,
        target,
      });
      if (options.facts) {
        return `${JSON.stringify(facts)}\n`;
      }
      if (options.define) {
        return `${definePair(facts)}\n`;
      }
      const paths = { cwd, directory };
      const entry = existingModule(
        cwd,
        options.entry === undefined ? join(directory, 'src/main.ts') : resolve(cwd, options.entry),
        'entry',
      );
      const application = applicationModule(paths, target, options.application);
      const output =
        options.out === undefined
          ? defaultOutput(directory, target, () => applicationName(manifest, options.name))
          : resolve(cwd, options.out);
      const plan = { application, directory, entry, facts, out: output, target };
      if (options.watch) {
        await watch(plan);
        return '';
      }
      build(plan);
      return `Built ${shown(cwd, output)} for ${target.name}.\n`;
    });
  });

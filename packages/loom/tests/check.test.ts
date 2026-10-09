import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { put, removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, linkInstalled, loom, runtimes } from './package.js';
import type { Link } from './package.js';

afterEach(() => {
  removeRoots();
});

/** How long a test that runs the TypeScript compiler or a build may take. */
const slow = 120_000;

const manifest = '{"name":"probe","type":"module","version":"1.0.0"}\n';

/** An entry that leaves a mark when it is imported, which `loom check` never does. */
const entry = `import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../entry-ran.txt', import.meta.url), 'ran');
`;

/** A clean application with one described action, which leaves a mark when it runs. */
const clean = `import { writeFileSync } from 'node:fs';

import { Application } from '@loomcli/core';

export const probe = new Application('probe', { description: 'Probe the check.' }).action(() => {
  writeFileSync(new URL('../action-ran.txt', import.meta.url), 'ran');
});
`;

/**
 * An application with two inputs whose converters throw, an undescribed option, and a plugin whose
 * `onGraphBuilt` hook rejects the graph: four faults, which `check()` returns in that order.
 */
const faulty = `import { writeFileSync } from 'node:fs';

import { Application, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';

function unconvertible(reason) {
  return {
    '~standard': {
      jsonSchema: {
        input: () => {
          throw new Error(reason);
        },
        output: () => ({}),
      },
      validate: (value) => ({ value }),
      vendor: 'probe',
      version: 1,
    },
  };
}

const shared = diagnosticRule('@fixture/judge/shared-name', {
  explanation: 'Each Command answers to a name of its own.',
  headline: 'Shared name',
});

const rejecting = plugin('@fixture/judge', {
  onGraphBuilt: () => {
    throw new DeclarationError(shared, { sentence: 'The graph shares a name.' });
  },
});

export const probe = new Application('probe', { description: 'Probe the check.', plugins: [rejecting] })
  .option('first', { description: 'The first.', type: 'string', validate: unconvertible('No first schema.') })
  .option('second', { description: 'The second.', type: 'string', validate: unconvertible('No second schema.') })
  .option('bare', { type: 'string' })
  .action(() => {
    writeFileSync(new URL('../action-ran.txt', import.meta.url), 'ran');
  });
`;

/** A tsconfig.json the fixture packages type-check against. */
const tsconfig = `${JSON.stringify({
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
    types: ['node'],
  },
  include: ['src'],
})}\n`;

/** A package with the application module and the entry, linking core and no compiler. */
function checkPackage(files: Record<string, string>, links: readonly Link[] = ['core']) {
  return fixturePackage({ 'package.json': manifest, 'src/main.ts': entry, ...files }, links);
}

/** What `check()` returns for a module, read from source under Bun, as each fault's message. */
function checkedMessages(module: string): string[] {
  const script = `const namespace = await import(${JSON.stringify(pathToFileURL(module).href)});
process.stdout.write(JSON.stringify(namespace.probe.check().map((fault) => fault.message)));
`;
  const result = spawnSync('bun', ['-e', script], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  return z.array(z.string()).parse(JSON.parse(result.stdout));
}

/** The banner rule of each Developer Diagnostic in the output, in the order it printed them. */
function rules(output: string): string[] {
  return [...output.matchAll(/^-- [A-Z ]+ -+ (?<rule>\S+)$/gmu)].map(
    (found) => found.groups?.rule ?? '',
  );
}

const skipped = /^note: .*so the type pass was skipped\.\n\n/u;

const examples = ['textstat', 'jsonkit'].map((name) =>
  fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)),
);

test.each(examples)(
  'the example application in %s checks clean, exits 0, and prints nothing',
  (example) => {
    expect(loom(example, ['check'])).toEqual({ status: 0, stderr: '', stdout: '' });
  },
  slow,
);

test(
  'a clean typed package exits 0, prints nothing, and runs neither its entry nor its action',
  () => {
    const root = checkPackage({ 'src/application.ts': clean, 'tsconfig.json': tsconfig }, [
      'core',
      'typescript',
      'types',
    ]);
    expect(loom(root, ['check'])).toEqual({ status: 0, stderr: '', stdout: '' });
    expect(existsSync(join(root, 'entry-ran.txt'))).toBe(false);
    expect(existsSync(join(root, 'action-ran.txt'))).toBe(false);
  },
  slow,
);

test('every fault prints as its Developer Diagnostic in order, one blank line apart, and no action runs', () => {
  const root = checkPackage({ 'src/application.ts': faulty });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(rules(result.stderr)).toEqual([
    '@loomcli/core/schema-converter-failed',
    '@loomcli/core/schema-converter-failed',
    '@loomcli/core/undescribed',
    '@fixture/judge/shared-name',
  ]);
  const messages = checkedMessages(join(root, 'src/application.ts'));
  expect(result.stderr.replace(skipped, '')).toBe(`${messages.join('\n\n')}\n`);
  expect(existsSync(join(root, 'action-ran.txt'))).toBe(false);
  expect(existsSync(join(root, 'entry-ran.txt'))).toBe(false);
});

test.each(runtimes)(
  'the application module loom build bundles, which reads distributed, returns the same faults under %s',
  (runtime) => {
    const root = checkPackage({ 'src/application.ts': faulty });
    expect(loom(root, ['build', '--target', 'node']).status).toBe(0);
    const reader = join(root, 'read.mjs');
    writeFileSync(
      reader,
      `const { probe } = await import('./dist/application.js');
process.stdout.write(JSON.stringify(probe.check().map((fault) => fault.message)));
`,
    );
    const result = execute(reader, [], { runtime });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(checkedMessages(join(root, 'src/application.ts')));
  },
  slow,
);

test('a fault a declaring call throws while the module loads prints that rule and exits 1', () => {
  const root = checkPackage({
    'src/application.ts': `import { Application } from '@loomcli/core';

export const probe = new Application('probe', { description: 'Probe the check.' })
  .option('verbose', { description: 'Say more.', multiple: true, type: 'boolean' })
  .action(() => undefined);
`,
  });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(rules(result.stderr)).toEqual(['@loomcli/core/boolean-option-multiple']);
  expect(result.stderr).toContain('Option "verbose" is a boolean option and declares multiple.');
});

test('any other throw while the module loads is a fault that names the module and the error', () => {
  const root = checkPackage({
    'src/application.ts': `throw new TypeError('The module broke.');\n`,
  });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(rules(result.stderr)).toEqual(['@loomcli/loom/application-load-failed']);
  expect(result.stderr).toContain('src/application.ts');
  expect(result.stderr).toContain('TypeError: The module broke.');
});

test.each([
  ['no Application', 'export const value = 1;\n'],
  [
    'two Applications',
    `import { Application } from '@loomcli/core';

export const one = new Application('one', { description: 'One.' }).action(() => undefined);
export const two = new Application('two', { description: 'Two.' }).action(() => undefined);
`,
  ],
])('a module that exports %s exits 1 and names the module', (_case, source) => {
  const root = checkPackage({ 'src/application.ts': source });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('src/application.ts');
});

test('an Application exported as default and under a name counts once and is found', () => {
  const root = checkPackage({
    'src/application.ts': `${clean}\nexport default probe;\n`,
  });
  expect(loom(root, ['check']).status).toBe(0);
});

test('an Application exported as default alone is found', () => {
  const root = checkPackage({
    'src/application.ts': `${clean.replace('export const probe', 'const probe')}\nexport default probe;\n`,
  });
  expect(loom(root, ['check']).status).toBe(0);
});

test('the check runs in the package directory, so its bunfig.toml applies from any working directory', () => {
  const root = checkPackage({
    'bunfig.toml': 'preload = ["./preload.ts"]\n',
    'preload.ts': 'Reflect.set(globalThis, "PRELOADED", true);\n',
    'src/application.ts': `if (!Reflect.get(globalThis, 'PRELOADED')) {
  throw new Error('The preload did not run.');
}
${clean}`,
  });
  const fromRoot = loom(root, ['check']);
  expect(fromRoot.status).toBe(0);
  expect(loom(join(root, 'src'), ['check'])).toEqual(fromRoot);
});

test('a module that keeps the event loop alive while it loads still ends the check', () => {
  const root = checkPackage({
    'src/application.ts': `${clean}\nsetInterval(() => undefined, 1000);\n`,
  });
  expect(loom(root, ['check']).status).toBe(0);
});

test('--application reads the module it names', () => {
  const root = checkPackage({ 'src/app.ts': faulty, 'src/application.ts': clean });
  const result = loom(root, ['check', '--application', 'src/app.ts']);
  expect(result.status).toBe(1);
  expect(rules(result.stderr)).toHaveLength(4);
});

test('a missing application module exits 1 and names it', () => {
  const root = checkPackage({});
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('src/application.ts');
});

test(
  "a type error exits 1 with the compiler's report",
  () => {
    const root = checkPackage(
      {
        'src/application.ts': `${clean}\nexport const count: number = 'many';\n`,
        'tsconfig.json': tsconfig,
      },
      ['core', 'typescript', 'types'],
    );
    const result = loom(root, ['check']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^src\/application\.ts\(\d+,\d+\): error TS2322: /mu);
  },
  slow,
);

test('a package with no TypeScript installed prints the note and still reports its graph faults', () => {
  const root = checkPackage({ 'src/application.ts': faulty, 'tsconfig.json': tsconfig });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(
    /^note: No TypeScript compiler resolves from the package, so the type pass was skipped\.\n\n/u,
  );
  expect(rules(result.stderr)).toHaveLength(4);
});

test('a package whose path holds a space resolves its core and passes a clean graph', () => {
  const root = join(temporaryRoot('loom-check-'), 'with space');
  for (const [path, body] of Object.entries({
    'package.json': manifest,
    'src/application.ts': clean,
    'src/main.ts': entry,
  })) {
    put(root, path, body);
  }
  linkInstalled(root, ['core']);
  expect(loom(root, ['check'])).toEqual({
    status: 0,
    stderr: 'note: The package has no tsconfig.json, so the type pass was skipped.\n',
    stdout: '',
  });
});

test('a package with no tsconfig.json prints the note and passes a clean graph', () => {
  const root = checkPackage({ 'src/application.ts': clean }, ['core', 'typescript']);
  expect(loom(root, ['check'])).toEqual({
    status: 0,
    stderr: 'note: The package has no tsconfig.json, so the type pass was skipped.\n',
    stdout: '',
  });
});

/** A managed file: its content under the header that records the content's checksum. */
function managed(content: string, frontmatter = '') {
  const checksum = createHash('sha256').update(`${frontmatter}${content}`).digest('hex');
  return `${frontmatter}<!-- Managed by loom init. sha256:${checksum} -->\n${content}`;
}

const guide = '\n# Change fragments\n\nName each fragment for its kind.\n';
const skill = '\n# Keep the changelog\n\nAdd a fragment for each change.\n';
const frontmatter = '---\nname: loom-changelog\ndescription: Keep the changelog.\n---\n';

test('an edited managed file draws one warning, and the check exits 0 when nothing else is wrong', () => {
  const root = checkPackage({
    '.agents/skills/loom-changelog/SKILL.md': managed(skill, frontmatter),
    '.changes/README.md': `${managed(guide)}An edit.\n`,
    'src/application.ts': clean,
  });
  const result = loom(root, ['check']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr.replace(skipped, '')).toBe(
    'warning: .changes/README.md differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.\n',
  );
});

test('an edited skill draws its warning after the faults, and a file without a header draws none', () => {
  const root = checkPackage({
    '.agents/skills/loom-changelog/SKILL.md': managed(skill, frontmatter).replace('each', 'every'),
    '.changes/README.md': `${guide}An edit with no header.\n`,
    'src/application.ts': faulty,
  });
  const result = loom(root, ['check']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(
    /shares a name\.\n[\s\S]*\n\nwarning: \.agents\/skills\/loom-changelog\/SKILL\.md differs from what loom init wrote\. Run loom init --force to restore it, or delete its header to keep your edits\.\n$/u,
  );
  expect(result.stderr.match(/^warning: /gmu)).toHaveLength(1);
});

test('unedited managed files draw no warning', () => {
  const root = checkPackage({
    '.agents/skills/loom-changelog/SKILL.md': managed(skill, frontmatter),
    '.changes/README.md': managed(guide),
    'src/application.ts': clean,
  });
  const result = loom(root, ['check']);
  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain('warning:');
});

test('a check outside any package fails and says to run it inside a package directory', () => {
  const result = loom(temporaryRoot('loom-check-'), ['check']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Run loom inside a package directory.');
});

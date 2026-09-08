import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';
import { z } from 'zod';

import { pnpm, pnpmExecutable, runProcess } from './publication-process.js';
import { readRegularFile } from './repository.js';

function installed(name: string) {
  const path = fileURLToPath(import.meta.resolve(`${name}/package.json`));
  const directory = dirname(path);
  const manifest = z
    .object({ bin: z.record(z.string(), z.string()).optional(), version: z.string() })
    .parse(JSON.parse(readRegularFile(directory, 'package.json')));
  return { directory: dirname(path), manifest };
}

export function checkConsumers(
  source: string,
  artifacts: string,
  packages: { name: string; file: string; exports: string[] }[],
  runtime: string,
) {
  const root = mkdtempSync(join(tmpdir(), 'loom-packed-consumer-'));
  try {
    const dependencies: Record<string, string> = {};
    const overrides: Record<string, string> = {};
    for (const library of packages) {
      const target = `file:${join(artifacts, library.file).replaceAll('\\', '/')}`;
      dependencies[library.name] = target;
      overrides[library.name] = target;
    }
    const examples = ['textstat', 'jsonkit'].filter((name) =>
      existsSync(join(source, 'examples', name)),
    );
    for (const name of examples) {
      const manifest = z
        .object({ dependencies: z.record(z.string(), z.string()) })
        .parse(JSON.parse(readRegularFile(source, `examples/${name}/package.json`)));
      for (const [dependency, version] of Object.entries(manifest.dependencies)) {
        if (!(dependency in dependencies)) {
          dependencies[dependency] = version;
        }
      }
      const destination = join(root, 'examples', name);
      cpSync(join(source, 'examples', name), destination, {
        filter: (path) => !['dist', 'node_modules'].includes(path.split(/[\\/]/u).at(-1) ?? ''),
        recursive: true,
      });
      writeFileSync(
        join(destination, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
      );
    }
    if (examples.length > 0) {
      dependencies['vite-plus'] = installed('vite-plus').manifest.version;
      dependencies['@types/node'] = installed('@types/node').manifest.version;
      cpSync(join(source, 'tsconfig.json'), join(root, 'tsconfig.json'));
      mkdirSync(join(root, 'scripts'));
      cpSync(join(source, 'scripts/test-process.ts'), join(root, 'scripts/test-process.ts'));
      writeFileSync(
        join(root, 'vite.config.mjs'),
        "import { defineConfig } from 'vite-plus'; export default defineConfig({ test: { include: ['examples/*/tests/**/*.test.ts'], testTimeout: 30000 } });\n",
      );
    }
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies, private: true, type: 'module' }),
    );
    writeFileSync(join(root, 'pnpm-workspace.yaml'), stringify({ overrides }));
    pnpm(root, ['install', '--ignore-scripts', '--prefer-offline', '--lockfile=false']);
    const specifiers = packages.flatMap((library) =>
      library.exports.map((name) =>
        name === '.' ? library.name : `${library.name}${name.slice(1)}`,
      ),
    );
    writeFileSync(
      join(root, 'consumer.ts'),
      specifiers
        .map((name, index) => `export * as library${index} from ${JSON.stringify(name)};`)
        .join('\n'),
    );
    writeFileSync(
      join(root, 'consumer.mjs'),
      specifiers.map((name) => `await import(${JSON.stringify(name)});`).join('\n'),
    );
    const typescript = installed('typescript');
    const compiler = typescript.manifest.bin?.tsc;
    if (compiler === undefined) {
      throw new Error('TypeScript compiler is unavailable.');
    }
    const tsc = join(typescript.directory, compiler);
    writeFileSync(
      join(root, 'consumer-config.json'),
      JSON.stringify({
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'types',
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        files: ['consumer.ts'],
      }),
    );
    runProcess(root, 'node', [tsc, '-p', 'consumer-config.json']);
    runProcess(root, runtime, ['consumer.mjs']);
    for (const name of examples) {
      runProcess(root, 'node', [tsc, '-p', `examples/${name}/tsconfig.json`]);
    }
    if (examples.length > 0) {
      pnpm(root, ['exec', 'vp', 'test', '--run'], { ...process.env, LOOM_TEST_RUNTIME: runtime });
    }
    const core = packages.find((library) => library.name === '@loomcli/core');
    if (core !== undefined) {
      const script = join(source, 'packages/core/tests/check-types.mjs');
      runProcess(source, 'node', [script], {
        ...process.env,
        LOOM_CORE_TARBALL: join(artifacts, core.file),
        npm_execpath: pnpmExecutable(),
      });
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

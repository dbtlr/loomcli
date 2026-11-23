import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js';

import { hasMaterialMarker } from './bundle-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const libraries = ['core', 'validators', 'plugins', 'prompts', 'eslint-plugin'];

/** Resolves the two private plugin dependencies so Bun bundles them with the pack. */
const privatePluginDependencies = {
  name: 'private-workspace-packages',
  setup(builder) {
    builder.onResolve({ filter: /^@loom\/(?:json|mcp)$/u }, ({ importer, path }) => ({
      path: Bun.resolveSync(path, dirname(importer)),
    }));
  },
};

function portable(path) {
  return path.split(sep).join('/');
}

/** Collects the runtime targets of every export, including nested conditions and aliases. */
function runtimeTargets(value) {
  if (typeof value === 'string') {
    return value.endsWith('.js') ? [value] : [];
  }
  return value && typeof value === 'object' ? Object.values(value).flatMap(runtimeTargets) : [];
}

/** Records the license markers before the emitted modules are replaced by bundles. */
function emittedSources(directory) {
  const dist = join(directory, 'dist');
  return Object.fromEntries(
    readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [portable(relative(directory, path)), hasMaterialMarker(readFileSync(path, 'utf8'))];
      }),
  );
}

/** Traces each Bun mapping through tsc's map, with paths relative to the published file. */
function composeMap(text, destination) {
  // In-memory Bun builds name their inputs relative to the current working directory.
  const map = new SourceMapConsumer(text);
  const composed = new SourceMapGenerator();
  const outputDirectory = dirname(destination);
  const inputs = new Map();
  for (const source of map.sources) {
    const input = resolve(root, source);
    const inputDirectory = dirname(input);
    const original = new SourceMapConsumer(readFileSync(`${input}.map`, 'utf8'));
    const paths = new Map();
    for (const file of original.sources) {
      const absolute = resolve(inputDirectory, file);
      const published = portable(relative(outputDirectory, absolute));
      paths.set(file, published);
      composed.setSourceContent(published, original.sourceContentFor(file));
    }
    inputs.set(source, { original, paths });
  }
  map.eachMapping((mapping) => {
    const generated = { column: mapping.generatedColumn, line: mapping.generatedLine };
    const input = inputs.get(mapping.source);
    const position = input?.original.originalPositionFor({
      column: mapping.originalColumn,
      line: mapping.originalLine,
    });
    const source = input?.paths.get(position?.source);
    if (source === undefined) {
      composed.addMapping({ generated });
      return;
    }
    composed.addMapping({
      generated,
      name: position.name ?? mapping.name,
      original: { column: position.column, line: position.line },
      source,
    });
  });
  return composed.toString();
}

async function bundleLibrary(name) {
  const directory = join(root, 'packages', name);
  const dist = join(directory, 'dist');
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const entrypoints = [
    ...new Set(runtimeTargets(manifest.exports).map((file) => resolve(directory, file))),
  ];
  const sources = emittedSources(directory);
  const emitted = Object.keys(sources);

  const result = await Bun.build({
    entrypoints,
    metafile: true,
    naming: { chunk: 'library-[hash].[ext]' },
    packages: 'external',
    plugins: name === 'plugins' ? [privatePluginDependencies] : [],
    root: dist,
    sourcemap: 'linked',
    splitting: true,
    target: 'node',
  });

  const outputs = Object.fromEntries(
    Object.entries(result.metafile.outputs).map(([file, output]) => [
      portable(join('dist', file)),
      Object.keys(output.inputs).map((input) =>
        portable(relative(directory, resolve(root, input))),
      ),
    ]),
  );
  // Private inputs share the pack's MIT license and go through the same notice checks.
  for (const input of new Set(Object.values(outputs).flat())) {
    if (!Object.hasOwn(sources, input)) {
      sources[input] = hasMaterialMarker(readFileSync(join(directory, input), 'utf8'));
    }
  }
  const artifacts = await Promise.all(
    result.outputs.map(async (artifact) => {
      const destination = join(dist, artifact.path);
      const text = await artifact.text();
      return {
        destination,
        text: artifact.kind === 'sourcemap' ? composeMap(text, destination) : text,
      };
    }),
  );
  for (const target of entrypoints) {
    if (!artifacts.some(({ destination }) => destination === target)) {
      throw new Error(`Bun did not emit the export target ${relative(directory, target)}.`);
    }
  }
  for (const file of emitted) {
    unlinkSync(join(directory, file));
    unlinkSync(join(directory, `${file}.map`));
  }
  for (const { destination, text } of artifacts) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  writeFileSync(join(dist, 'provenance.json'), JSON.stringify({ outputs, sources }));
}

process.chdir(root);
for (const library of libraries) {
  await bundleLibrary(library);
}

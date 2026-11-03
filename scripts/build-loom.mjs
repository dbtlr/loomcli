import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Builds the published `loom` bin with `loom build` itself, run from source under Bun, so the
 * toolchain ships as the distributed bundle every author's application ships as.
 * `loom build` bundles the entry and the application module. The processes `loom init` and
 * `loom build` start to read an application module each run one more module, which a plain Bun
 * build writes beside them.
 *
 * The bundle carries other packages' code, so their license notices must travel with it. A
 * distributed `loom build` minifies its bundle, which drops the comment Bun writes above each
 * module, so the packages the bundle holds come from a Bun metafile instead: one more Bun build of
 * the same entries, with the arguments and `NODE_ENV` `loom build` uses for a distributed node
 * bundle, writes it, and each reader's build writes its own. A package counts when Bun put any of
 * its code in an output. The build copies each package's license, notice, and licenses/ files into
 * dist/licenses and lists them in dist/NOTICE. It fails when a bundled package has no license file,
 * or when its license is not in the license field of the loom package.
 */

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = join(repositoryRoot, 'packages/loom');
const distribution = join(directory, 'dist');
const licensesDirectory = join(distribution, 'licenses');

/** The folder the metafiles are written to, inside the checkout and removed when the build ends. */
const metafiles = join(repositoryRoot, 'node_modules/.cache/build-loom');
rmSync(metafiles, { force: true, recursive: true });
process.on('exit', () => rmSync(metafiles, { force: true, recursive: true }));

/** Runs Bun in the toolchain's package directory and stops the build when Bun fails. */
function bun(args, env = process.env) {
  const result = spawnSync('bun', args, { cwd: directory, env, stdio: 'inherit' });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    console.error('Building the loom bin needs Bun on the PATH. Install it from https://bun.sh.');
    process.exit(1);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

bun(['src/main.ts', 'build', '--target', 'node']);
bun(
  [
    'build',
    'src/main.ts',
    'src/application.ts',
    '--target',
    'node',
    '--splitting',
    '--minify-whitespace',
    '--minify-syntax',
    '--outdir',
    join(metafiles, 'bundle'),
    `--metafile=${join(metafiles, 'bundle.json')}`,
  ],
  { ...process.env, NODE_ENV: 'production' },
);
for (const reader of ['read-application', 'read-skills']) {
  bun([
    'build',
    `src/${reader}.ts`,
    '--target',
    'bun',
    '--outfile',
    `dist/${reader}.js`,
    `--metafile=${join(metafiles, `${reader}.json`)}`,
  ]);
}

/** Names the file of a license text that sits beside a package's manifest. */
const licenseFilePattern = /^(?:licen[sc]e|copying)(?:\.(?:md|txt))?$/i;
const noticeFilePattern = /^notice(?:\.(?:md|txt))?$/i;

const pnpmStorePattern = /^node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+\//;
const workspacePattern = /^packages\/[^/]+\//;

/** Names the package directory a module's repository-relative path sits in, or undefined for a file outside any package. */
function packageDirectoryOf(path) {
  const found = pnpmStorePattern.exec(path) ?? workspacePattern.exec(path);
  if (!found) {
    return undefined;
  }
  const candidate = resolve(repositoryRoot, found[0]);
  return existsSync(join(candidate, 'package.json')) ? candidate : undefined;
}

/** The modules Bun put code from into an output a metafile describes, by repository-relative path. */
function bundledModules(metafile) {
  const { outputs } = JSON.parse(readFileSync(metafile, 'utf8'));
  return Object.values(outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => relative(repositoryRoot, resolve(directory, path))),
  );
}

/** Finds every package directory the built files hold code from, except the loom package itself. */
function bundledPackageDirectories() {
  const directories = new Set();
  for (const file of readdirSync(metafiles).filter((name) => name.endsWith('.json'))) {
    for (const path of bundledModules(join(metafiles, file))) {
      const found = packageDirectoryOf(path);
      if (found !== undefined && found !== directory) {
        directories.add(found);
      }
    }
  }
  return [...directories];
}

/** Reads the name, version, and license a bundled package's manifest declares. */
function readManifest(packageDirectory) {
  const { name, version, license } = JSON.parse(
    readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
  );
  if (typeof license !== 'string') {
    throw new Error(`The bundled package ${name} declares no SPDX license expression.`);
  }
  return { license, name, version };
}

/** Splits an SPDX expression into its identifiers. */
function licenseIdentifiers(expression) {
  return expression
    .split(/\s+(?:AND|OR)\s+|[()]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Fails the build when a bundled package's license is not one the loom package declares. */
function assertLicenseDeclared(bundled, declared) {
  const allowed = licenseIdentifiers(declared);
  for (const identifier of licenseIdentifiers(bundled.license)) {
    if (!allowed.includes(identifier)) {
      throw new Error(
        `The loom bin bundles ${bundled.name}, which is licensed ${bundled.license}, but the license field of @loomcli/loom ("${declared}") does not include ${identifier}. Add it to the field in packages/loom/package.json.`,
      );
    }
  }
}

/** Lists the files of a package directory whose names match, as paths from that directory. */
function matchingFiles(packageDirectory, pattern, folder = '') {
  const names = readdirSync(join(packageDirectory, folder), { withFileTypes: true });
  return names
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(folder, entry.name));
}

/** Copies a package's license, notice, and licenses/ files into dist/licenses under names that cannot collide. */
function copyNoticeFiles(packageDirectory, name) {
  const licenses = matchingFiles(packageDirectory, licenseFilePattern);
  if (licenses.length === 0) {
    throw new Error(`The bundled package ${name} ships no license file to copy.`);
  }
  const notices = matchingFiles(packageDirectory, noticeFilePattern);
  const extras = readdirSync(packageDirectory).includes('licenses')
    ? matchingFiles(packageDirectory, /./, 'licenses')
    : [];
  const prefix = name.replace('/', '__');
  return [...licenses, ...notices, ...extras].map((file) => {
    const copied = `${prefix}-${file.split('/').pop()}`;
    copyFileSync(join(packageDirectory, file), join(licensesDirectory, copied));
    return `licenses/${copied}`;
  });
}

/** Renders dist/NOTICE: a header and one entry per bundled package. */
function renderNotice(entries) {
  const header = [
    'The loom bin bundles the packages listed below. Each package stays under its own license,',
    'and the files named under it hold the license text and notices it asks to keep with its code.',
  ];
  const blocks = entries.map(({ name, version, license, files }) =>
    [`${name} ${version}`, `License: ${license}`, ...files.map((file) => `  ${file}`)].join('\n'),
  );
  return `${header.join('\n')}\n\n${blocks.join('\n\n')}\n`;
}

/** Writes dist/licenses and dist/NOTICE from the packages the built files hold. */
function writeNotices() {
  const declared = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).license;
  rmSync(licensesDirectory, { force: true, recursive: true });
  mkdirSync(licensesDirectory, { recursive: true });
  const bundled = bundledPackageDirectories().map((packageDirectory) => ({
    manifest: readManifest(packageDirectory),
    packageDirectory,
  }));
  const entries = bundled
    .toSorted((left, right) => left.manifest.name.localeCompare(right.manifest.name))
    .map(({ packageDirectory, manifest }) => {
      assertLicenseDeclared(manifest, declared);
      const files = copyNoticeFiles(packageDirectory, manifest.name);
      return { files, license: manifest.license, name: manifest.name, version: manifest.version };
    });
  writeFileSync(join(distribution, 'NOTICE'), renderNotice(entries));
}

try {
  writeNotices();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

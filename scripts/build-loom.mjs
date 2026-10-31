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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Builds the published `loom` bin with `loom build` itself, run from source under Bun, so the
 * toolchain ships as the distributed bundle every author's application ships as.
 * `loom build` bundles the entry and the application module. The process `loom init` starts to read
 * an application module runs one more module, which a second, plain Bun build writes beside them.
 *
 * The bundle carries other packages' code, so their license notices must travel with it. Bun writes
 * the source path of each module it bundles in a comment above the module, and the build reads
 * those comments to find the packages the bundle holds, copies each package's license, notice, and
 * licenses/ files into dist/licenses, and lists them in dist/NOTICE. The build fails when a bundled
 * package has no license file, or when its license is not in the license field of the loom package.
 */

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = join(repositoryRoot, 'packages/loom');
const distribution = join(directory, 'dist');
const licensesDirectory = join(distribution, 'licenses');

/** Runs Bun in the toolchain's package directory and stops the build when Bun fails. */
function bun(args) {
  const result = spawnSync('bun', args, { cwd: directory, stdio: 'inherit' });
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
bun([
  'build',
  'src/read-application.ts',
  '--target',
  'bun',
  '--outfile',
  'dist/read-application.js',
]);

/** Names the file of a license text that sits beside a package's manifest. */
const licenseFilePattern = /^(?:licen[sc]e|copying)(?:\.(?:md|txt))?$/i;
const noticeFilePattern = /^notice(?:\.(?:md|txt))?$/i;

/** The module comments Bun writes: a source path, as many `../` as the file's depth needs. */
const moduleCommentPattern = /^\/\/ (?:\.\.\/)+(?<path>\S+)$/gm;
const pnpmStorePattern = /^node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+\//;

/** Names the package directory a module comment's path sits in, or undefined for a file outside any package. */
function packageDirectoryOf(path) {
  const store = pnpmStorePattern.exec(path);
  if (store) {
    return join(repositoryRoot, store[0]);
  }
  const [workspace] = path.split('/');
  const candidate = join(repositoryRoot, 'packages', workspace);
  return existsSync(join(candidate, 'package.json')) ? candidate : undefined;
}

/** Finds every package directory the bundled files name, except the loom package itself. */
function bundledPackageDirectories() {
  const directories = new Set();
  for (const file of readdirSync(distribution).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(distribution, file), 'utf8');
    for (const { groups } of source.matchAll(moduleCommentPattern)) {
      const found = packageDirectoryOf(groups.path);
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

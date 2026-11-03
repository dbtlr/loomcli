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

/*
 * The loom bin's bundle carries other packages' code, so their license notices must travel with it.
 * Bun writes the source path of each module it bundles in a comment above the module. These
 * functions read those comments to find the packages the bundle holds, copy each package's license
 * and notice files into dist/licenses, and list them in dist/NOTICE.
 *
 * A third-party package counts with its whole declared license. A workspace package counts with the
 * repository's own license plus the license of each piece of third-party material whose files the
 * bundle holds, so a license that covers only files the bundle leaves out stays out of loom's field.
 * The build fails when the loom package's license field misses a license the bundle needs, declares
 * one it does not need, or when a bundled module comes from a location whose license it cannot read.
 */

/**
 * The third-party material each workspace package ships, by the files it covers, the license those
 * files stay under, and the files beside the package's manifest that hold that license's text. The
 * package's NOTICE describes each entry in prose, and its license field names each entry's license.
 * A ported or generated file states its source's copyright, or that it is ported, in a comment the
 * compiled file keeps, so the build can find one the table leaves out.
 */
const workspaceMaterial = {
  '@loomcli/core': [
    {
      files: ['dist/unicode.generated.js'],
      license: 'Unicode-3.0',
      texts: ['licenses/unicode-LICENSE.txt', 'licenses/uucode-LICENSE.md'],
    },
    { files: ['dist/style-width.js'], license: 'MIT', texts: ['licenses/uucode-LICENSE.md'] },
    {
      files: ['dist/glyphs.generated.js'],
      license: 'MIT',
      texts: ['licenses/inquirer-figures-LICENSE.txt', 'licenses/figures-LICENSE.txt'],
    },
  ],
  '@loomcli/plugins': [
    {
      files: ['bash', 'zsh', 'fish', 'powershell'].map(
        (shell) => `dist/src/completion/${shell}.js`,
      ),
      license: 'Apache-2.0',
      texts: ['licenses/cobra-LICENSE.txt'],
    },
  ],
};

/** Names the file of a license text that sits beside a package's manifest. */
const licenseFilePattern = /^(?:licen[sc]e|copying)(?:\.(?:md|txt))?$/i;
const noticeFilePattern = /^notice(?:\.(?:md|txt))?$/i;

/** Marks a compiled file that carries third-party material: a copyright line or a port statement. */
const materialMarkerPattern = /\bCopyright\b|\b[Pp]orted from\b/;

/** The module comments Bun writes: a source path, as many `../` as the file's depth needs. */
const moduleCommentPattern = /^\/\/ (?:\.\.\/)+(?<path>\S+)$/gm;
const pnpmStorePattern = /^node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+\//;

/** Splits an SPDX expression into its identifiers. */
function licenseIdentifiers(expression) {
  return expression
    .split(/\s+(?:AND|OR)\s+|[()]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Reads a package manifest's name, version, and SPDX license expression. */
function readManifest(packageDirectory) {
  const { name, version, license } = JSON.parse(
    readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
  );
  if (typeof license !== 'string') {
    throw new Error(`The bundled package ${name} declares no SPDX license expression.`);
  }
  return { license, name, version };
}

/** Reads the license field of the manifest in a directory. */
function readManifestLicense(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).license;
}

/**
 * Names where a bundled module comes from: a pnpm store package, a file of a workspace package, or
 * the loom package itself. A module from anywhere else fails the build, because its license cannot
 * be read and would ship without a notice.
 */
function moduleOrigin(repositoryRoot, path) {
  const store = pnpmStorePattern.exec(path);
  if (store) {
    return { directory: join(repositoryRoot, store[0]), kind: 'store' };
  }
  if (path === 'package.json' || path.startsWith('src/')) {
    return { kind: 'loom' };
  }
  const [workspace, ...rest] = path.split('/');
  const directory = join(repositoryRoot, 'packages', workspace);
  if (existsSync(join(directory, 'package.json'))) {
    return workspace === 'loom'
      ? { kind: 'loom' }
      : { directory, file: rest.join('/'), kind: 'workspace' };
  }
  throw new Error(
    `The loom bin bundles ${path}, which is neither in the pnpm store nor in a workspace package, so the build cannot find its license.`,
  );
}

/**
 * Maps each package directory the bundle holds to whether it is a workspace package and, for a
 * workspace package, the files of it the bundle holds.
 */
function bundledPackages(repositoryRoot, distribution) {
  const packages = new Map();
  for (const file of readdirSync(distribution).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(distribution, file), 'utf8');
    for (const { groups } of source.matchAll(moduleCommentPattern)) {
      const origin = moduleOrigin(repositoryRoot, groups.path);
      if (origin.kind !== 'loom') {
        const found = packages.get(origin.directory) ?? {
          files: new Set(),
          workspace: origin.kind === 'workspace',
        };
        if (origin.file !== undefined) {
          found.files.add(origin.file);
        }
        packages.set(origin.directory, found);
      }
    }
  }
  return packages;
}

/**
 * Fails the build unless the material table describes a workspace package as it is: the package's
 * license field names exactly its own license and each entry's, every file an entry names exists,
 * every license text in its licenses/ folder belongs to an entry, and a package with a NOTICE has an
 * entry, and every compiled file that states a copyright or a port belongs to an entry. A port added
 * to a package without a table entry then fails the build instead of shipping without its notice.
 */
function assertMaterialTable(manifest, packageDirectory, material, ownLicense) {
  const table = 'the material table in scripts/bundle-notices.mjs';
  const covered = new Set([ownLicense, ...material.map((entry) => entry.license)]);
  const declared = new Set(licenseIdentifiers(manifest.license));
  if (
    covered.size !== declared.size ||
    [...covered].some((identifier) => !declared.has(identifier))
  ) {
    throw new Error(
      `${manifest.name} is licensed ${manifest.license}, but ${table} gives it ${[...covered].join(' AND ')}. Update the table.`,
    );
  }
  const named = material.flatMap((entry) => [...entry.files, ...entry.texts]);
  const missing = named.find((file) => !existsSync(join(packageDirectory, file)));
  if (missing !== undefined) {
    throw new Error(
      `${table} names ${manifest.name}'s ${missing}, which does not exist. Update the table.`,
    );
  }
  const shipped = existsSync(join(packageDirectory, 'licenses'))
    ? matchingFiles(packageDirectory, /./, 'licenses')
    : [];
  const unnamed = shipped.find((file) => !named.includes(file));
  if (unnamed !== undefined) {
    throw new Error(
      `${manifest.name} ships ${unnamed}, which no entry of ${table} names. Add the material it covers to the table.`,
    );
  }
  const marked = compiledFiles(packageDirectory).find(
    (file) =>
      !named.includes(file) &&
      materialMarkerPattern.test(readFileSync(join(packageDirectory, file), 'utf8')),
  );
  if (marked !== undefined) {
    throw new Error(
      `${manifest.name}'s ${marked} states a copyright or a port, but no entry of ${table} names it. Add the material it carries to the table.`,
    );
  }
  if (material.length === 0 && matchingFiles(packageDirectory, noticeFilePattern).length > 0) {
    throw new Error(
      `${manifest.name} ships a NOTICE, but ${table} names no third-party material for it. Add the material to the table.`,
    );
  }
}

/**
 * Names the license identifiers a bundled workspace package needs, and the license texts beyond its
 * own LICENSE that go with them: its own license, and each material entry whose files the bundle
 * holds.
 */
function workspaceLicense(manifest, packageDirectory, files, ownLicense) {
  const material = workspaceMaterial[manifest.name] ?? [];
  assertMaterialTable(manifest, packageDirectory, material, ownLicense);
  const bundled = material.filter((entry) => entry.files.some((file) => files.has(file)));
  return {
    identifiers: [...new Set([ownLicense, ...bundled.map((entry) => entry.license)])],
    texts: [...new Set(bundled.flatMap((entry) => entry.texts))],
  };
}

/** Lists the JavaScript files of a package's dist folder, as paths from the package directory. */
function compiledFiles(packageDirectory) {
  const distribution = join(packageDirectory, 'dist');
  if (!existsSync(distribution)) {
    return [];
  }
  return readdirSync(distribution, { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .map((file) => join('dist', file));
}

/** Lists the files of a package directory whose names match, as paths from that directory. */
function matchingFiles(packageDirectory, pattern, folder = '') {
  const names = readdirSync(join(packageDirectory, folder), { withFileTypes: true });
  return names
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(folder, entry.name));
}

/**
 * Names the files that carry a bundled package's license and notices: its license file, and for a
 * third-party package its notice and licenses/ files too. A workspace package adds its notice and
 * the texts of its third-party material only when the bundle holds files they cover.
 */
function noticeFiles(packageDirectory, name, texts) {
  const licenses = matchingFiles(packageDirectory, licenseFilePattern);
  if (licenses.length === 0) {
    throw new Error(`The bundled package ${name} ships no license file to copy.`);
  }
  if (texts === undefined) {
    const extras = readdirSync(packageDirectory).includes('licenses')
      ? matchingFiles(packageDirectory, /./, 'licenses')
      : [];
    return [...licenses, ...matchingFiles(packageDirectory, noticeFilePattern), ...extras];
  }
  const notices = texts.length > 0 ? matchingFiles(packageDirectory, noticeFilePattern) : [];
  return [...licenses, ...notices, ...texts];
}

/** Copies a package's license and notice files into dist/licenses under names that cannot collide. */
function copyNoticeFiles(packageDirectory, name, files, licensesDirectory) {
  const prefix = name.replace('/', '__');
  return files.map((file) => {
    const copied = `${prefix}-${file.split('/').pop()}`;
    copyFileSync(join(packageDirectory, file), join(licensesDirectory, copied));
    return `licenses/${copied}`;
  });
}

/** Fails the build unless the loom package's license field names exactly the licenses the bundle needs. */
function assertLicenseField(declared, needed) {
  const declaredIdentifiers = licenseIdentifiers(declared);
  for (const { identifier, name, license } of needed) {
    if (!declaredIdentifiers.includes(identifier)) {
      throw new Error(
        `The loom bin bundles ${name}, which is licensed ${license}, but the license field of @loomcli/loom ("${declared}") does not include ${identifier}. Add it to the field in packages/loom/package.json.`,
      );
    }
  }
  const surplus = declaredIdentifiers.find(
    (identifier) => !needed.some((entry) => entry.identifier === identifier),
  );
  if (surplus !== undefined) {
    throw new Error(
      `The license field of @loomcli/loom ("${declared}") declares ${surplus}, which no bundled module needs. Remove it from the field in packages/loom/package.json.`,
    );
  }
}

/** Renders dist/NOTICE: a header and one entry per bundled package. */
function renderNotice(entries) {
  const header = [
    'The loom bin bundles the packages listed below. Each package stays under its own license,',
    'and the files named under it hold the license text and notices it asks to keep with its code.',
    'For a Loom workspace package, the license line names the licenses of the files the bin holds.',
  ];
  const blocks = entries.map(({ name, version, license, files }) =>
    [`${name} ${version}`, `License: ${license}`, ...files.map((file) => `  ${file}`)].join('\n'),
  );
  return `${header.join('\n')}\n\n${blocks.join('\n\n')}\n`;
}

/** Writes the loom package's dist/licenses and dist/NOTICE from the packages its built files hold. */
function writeNotices(repositoryRoot) {
  const directory = join(repositoryRoot, 'packages/loom');
  const distribution = join(directory, 'dist');
  const licensesDirectory = join(distribution, 'licenses');
  const ownLicense = readManifestLicense(repositoryRoot);
  const declared = readManifestLicense(directory);
  const bundled = [...bundledPackages(repositoryRoot, distribution)].map(
    ([packageDirectory, { files, workspace }]) => {
      const manifest = readManifest(packageDirectory);
      const { identifiers, texts } = workspace
        ? workspaceLicense(manifest, packageDirectory, files, ownLicense)
        : { identifiers: licenseIdentifiers(manifest.license), texts: undefined };
      const license = workspace ? identifiers.join(' AND ') : manifest.license;
      return { identifiers, license, manifest, packageDirectory, texts };
    },
  );
  assertLicenseField(declared, [
    { identifier: ownLicense, license: ownLicense, name: '@loomcli/loom' },
    ...bundled.flatMap(({ identifiers, license, manifest }) =>
      identifiers.map((identifier) => ({ identifier, license, name: manifest.name })),
    ),
  ]);
  rmSync(licensesDirectory, { force: true, recursive: true });
  mkdirSync(licensesDirectory, { recursive: true });
  const entries = bundled
    .toSorted((left, right) => left.manifest.name.localeCompare(right.manifest.name))
    .map(({ license, manifest, packageDirectory, texts }) => ({
      files: copyNoticeFiles(
        packageDirectory,
        manifest.name,
        noticeFiles(packageDirectory, manifest.name, texts),
        licensesDirectory,
      ),
      license,
      name: manifest.name,
      version: manifest.version,
    }));
  writeFileSync(join(distribution, 'NOTICE'), renderNotice(entries));
}

export { writeNotices };

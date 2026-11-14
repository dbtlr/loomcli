#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node strips the types of this TypeScript module as it loads, which needs Node 22.18 or later.
import { extractLinks } from '../packages/loom/src/helpers/markdown-links.ts';

/*
 * Points a published package's README at the docs of its own version. npm shows the README a
 * version was published with, so a link to `main` would describe later behavior and break when a
 * docs page moves. Each published package runs `pin` as its prepack script and `unpin` as its
 * postpack script, so the tarball's README links to `blob/v<version>/` while the source README keeps
 * `blob/main/`, which reads correctly on GitHub between releases. Both run in the package's
 * directory, as pnpm runs a lifecycle script, and read the version from its `package.json`.
 */

const repository = 'https://github.com/dbtlr/loomcli/';
const sourceRef = `${repository}blob/main/`;

/** The prefix of a link to a file at the given version's release tag. */
function taggedRef(version) {
  return `${repository}blob/v${version}/`;
}

/** The README text with every link to a file on `main` pointed at the version's tag instead. */
function pinLinks(text, version) {
  return text.replaceAll(sourceRef, taggedRef(version));
}

/**
 * The README text with every link to a file at the version's tag pointed back at `main`. It
 * reverses `pinLinks` exactly while the source README names no tag, which the README test checks.
 */
function unpinLinks(text, version) {
  return text.replaceAll(taggedRef(version), sourceRef);
}

/**
 * A URL of a file or folder in the repository, at any ref: on github.com through `blob`, `tree`, or
 * `raw`, with or without `www.` and over either scheme, or on raw.githubusercontent.com. It matches
 * anywhere in the text, so a bare URL, an autolink, or an HTML attribute counts as well as a link.
 */
const absoluteFileUrl =
  /https?:\/\/(?:(?:www\.)?github\.com\/dbtlr\/loomcli\/(?:blob|tree|raw)\/|raw\.githubusercontent\.com\/dbtlr\/loomcli\/)[^\s)>\]"'<]+/giu;

/** Whether a link target opens with a URL scheme (`https:`, `mailto:`) or is protocol-relative. */
const notRelative = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

/**
 * Every link from the README into the repository's files: each absolute URL of a file or folder,
 * in text order, then each relative link target, which npm would resolve against the default
 * branch. An anchor within the page and a link to another site are not repository links.
 */
function repositoryLinks(text) {
  const absolute = [...text.matchAll(absoluteFileUrl)].map(([link]) => link);
  const relative = extractLinks(text)
    .map(({ target }) => target.trim())
    .filter((target) => target !== '' && !target.startsWith('#') && !notRelative.test(target));
  return [...absolute, ...relative];
}

/** Rewrites the README in the current directory in place, by the named mode. */
function rewriteReadme(mode) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`${process.cwd()}/package.json declares no version.`);
  }
  const text = readFileSync('README.md', 'utf8');
  const rewritten =
    mode === 'pin' ? pinLinks(text, manifest.version) : unpinLinks(text, manifest.version);
  if (rewritten !== text) {
    writeFileSync('README.md', rewritten);
  }
}

/** Whether this file is the one Node was asked to run, rather than one importing it. */
function runDirectly() {
  const entry = process.argv[1];
  return (
    entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (runDirectly()) {
  const mode = process.argv[2];
  if (mode !== 'pin' && mode !== 'unpin') {
    process.stderr.write('readme-links: Supply the mode, pin or unpin.\n');
    process.exitCode = 2;
  } else {
    rewriteReadme(mode);
  }
}

export { pinLinks, repositoryLinks, unpinLinks };

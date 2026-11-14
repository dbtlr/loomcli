#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node strips the types of this TypeScript module as it loads, which needs Node 22.18 or later.
import { extractLinks, proseLines } from '../packages/loom/src/helpers/markdown-links.ts';

/**
 * Checks that every relative link in the repository's Markdown files resolves. It reads each
 * Markdown file Git tracks or would track, finds its inline links, images, and reference
 * definitions, and reports a target that names no file or directory, or a `#fragment` that names no
 * heading or HTML anchor in a Markdown target. External targets (any URL scheme, or `//`) are not
 * fetched. YAML frontmatter, fenced code blocks, and inline code spans are skipped. Each broken
 * link prints as `path:line: target: reason`, and the script exits 1; it exits 0 silently when
 * every link resolves. `pnpm check` runs it, and so does the documentation-only CI job, which does
 * not run `pnpm check`.
 *
 * A change fragment in `.changes/` links relative to the repository root, where its compiled entry
 * will live, so the script resolves its links from there.
 */

/** The repository root. */
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

/** The path segments whose Markdown the script skips. */
const skippedSegments = new Set(['dist', 'node_modules']);

/** Whether a target opens with a URL scheme (`https:`, `mailto:`) or is protocol-relative. */
const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

/** An ATX heading, with its optional closing run of `#`. */
const heading = /^ {0,3}#{1,6}[ \t]+(?<text>.*?)(?:[ \t]+#+)?[ \t]*$/u;

/** An explicit HTML anchor, by the `id` or `name` it declares. */
const htmlAnchor = /<a\s[^>]*?\b(?:id|name)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/giu;

/** A character GitHub drops from a heading before it makes the slug. */
const droppedFromSlug = /[^\p{L}\p{M}\p{N}_ -]/gu;

/**
 * The anchor GitHub makes from one heading's text: lowercase, link text without its target,
 * punctuation removed, and spaces turned into hyphens.
 */
function slugify(text) {
  return text
    .replaceAll(/!?\[(?<label>[^\]]*)\]\([^)]*\)/gu, '$<label>')
    .toLowerCase()
    .replaceAll(droppedFromSlug, '')
    .replaceAll(' ', '-');
}

/** The anchors one Markdown text offers: heading slugs, repeats numbered, and HTML anchors. */
function collectAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const { blanked: line, raw } of proseLines(text)) {
    const found = heading.exec(raw)?.groups?.text;
    if (found !== undefined) {
      const slug = slugify(found);
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    for (const match of line.matchAll(htmlAnchor)) {
      anchors.add(match.groups?.double ?? match.groups?.single ?? '');
    }
  }
  return anchors;
}

/** Decodes percent-escapes, leaving the text as written when an escape is malformed. */
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The directory a file's relative links resolve against: its own, except for a change fragment in
 * `.changes/`, whose links are relative to the repository root.
 */
function baseDirectory(root, file) {
  const fragment = /^\.changes\/(?!README\.md$)[^/]+\.md$/u.test(file);
  return fragment ? root : dirname(join(root, file));
}

/** The reason a link target is broken, or undefined when it resolves. */
function brokenReason(root, file, target, anchorsOf) {
  const clean = target.trim().replace(/^<(?<inner>.*)>$/u, '$<inner>');
  if (clean === '' || external.test(clean)) {
    return undefined;
  }
  const hash = clean.indexOf('#');
  const path = decode((hash === -1 ? clean : clean.slice(0, hash)).replace(/\?.*$/u, ''));
  const fragment = hash === -1 ? undefined : decode(clean.slice(hash + 1));
  let destination = join(root, file);
  if (path !== '') {
    destination = path.startsWith('/')
      ? join(root, path)
      : resolve(baseDirectory(root, file), path);
  }
  if (!existsSync(destination)) {
    return 'no such file';
  }
  const checksAnchor = fragment !== undefined && fragment !== '' && destination.endsWith('.md');
  if (checksAnchor && statSync(destination).isFile() && !anchorsOf(destination).has(fragment)) {
    return 'no such anchor';
  }
  return undefined;
}

/**
 * Checks every link in the given files, as paths from `root`. It returns one
 * `{ file, line, target, reason }` for each link that does not resolve, in file and line order.
 */
function checkLinks(root, files) {
  const cache = new Map();
  const anchorsOf = (path) => {
    if (!cache.has(path)) {
      cache.set(path, collectAnchors(readFileSync(path, 'utf8')));
    }
    return cache.get(path);
  };
  const broken = [];
  for (const file of files.toSorted()) {
    for (const { line, target } of extractLinks(readFileSync(join(root, file), 'utf8'))) {
      const reason = brokenReason(root, file, target, anchorsOf);
      if (reason !== undefined) {
        broken.push({ file, line, reason, target });
      }
    }
  }
  return broken;
}

/** The lines the script prints for broken links, as `path:line: target: reason`. */
function formatBroken(broken) {
  return broken.map(({ file, line, reason, target }) => `${file}:${line}: ${target}: ${reason}`);
}

/** The Markdown files Git tracks or would track, as paths from the root, without dependencies. */
function markdownFiles(root) {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.md'],
    { cwd: root, encoding: 'utf8' },
  );
  return listed
    .split('\0')
    .filter((file) => file !== '' && existsSync(join(root, file)))
    .filter((file) => !file.split('/').some((segment) => skippedSegments.has(segment)));
}

/** Whether this file is the one Node was asked to run, rather than one importing it. */
function runDirectly() {
  const entry = process.argv[1];
  return (
    entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (runDirectly()) {
  const lines = formatBroken(checkLinks(repositoryRoot, markdownFiles(repositoryRoot)));
  if (lines.length > 0) {
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = 1;
  }
}

export { checkLinks, collectAnchors, formatBroken, markdownFiles, slugify };

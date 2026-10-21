#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The opening of a fenced code block: its indentation, its fence, and the rest of the line. */
const fenceOpening = /^(?<indent>\s*)(?<fence>`{3,}|~{3,})(?<info>.*)$/u;

/** An ATX heading, with its optional closing run of `#`. */
const heading = /^ {0,3}#{1,6}[ \t]+(?<text>.*?)(?:[ \t]+#+)?[ \t]*$/u;

/** An explicit HTML anchor, by the `id` or `name` it declares. */
const htmlAnchor = /<a\s[^>]*?\b(?:id|name)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/giu;

/** A reference definition: its label and the target that follows. */
const referenceDefinition =
  /^ {0,3}\[(?<label>[^\]]+)\]:[ \t]*(?:<(?<angled>[^>]*)>|(?<bare>\S+))/u;

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

/** Blanks every inline code span in one line, so a link inside it is not read. */
function blankCodeSpans(line) {
  return line.replaceAll(/(?<!`)(?<run>`+)(?!`)(?<body>.*?)(?<!`)\k<run>(?!`)/gu, (span) =>
    ' '.repeat(span.length),
  );
}

/**
 * The lines of a Markdown text that prose can occupy, as `{ line, raw, text }` with the 1-based
 * line number: frontmatter and fenced code blocks are left out, and `text` is the line with its
 * inline code spans blanked.
 */
function proseLines(text) {
  const lines = text.split(/\r?\n/u);
  const prose = [];
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    start = end === -1 ? 0 : end + 1;
  }
  let open = '';
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (open === '') {
      const opening = fenceOpening.exec(line);
      if (
        opening?.groups !== undefined &&
        !(opening.groups.fence.startsWith('`') && opening.groups.info.includes('`'))
      ) {
        open = opening.groups.fence;
      } else {
        prose.push({ line: index + 1, raw: line, text: blankCodeSpans(line) });
      }
    } else if (new RegExp(`^\\s*${open[0]}{${open.length},}\\s*$`, 'u').test(line)) {
      open = '';
    }
  }
  return prose;
}

/** The anchors one Markdown text offers: heading slugs, repeats numbered, and HTML anchors. */
function collectAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const { raw, text: line } of proseLines(text)) {
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

/** Reads an unbracketed destination: a run without spaces whose parentheses balance. */
function bareDestination(rest) {
  let depth = 0;
  const first = /^[ \t]*/u.exec(rest)?.[0].length ?? 0;
  let index = first;
  for (; index < rest.length; index += 1) {
    const char = rest[index] ?? '';
    if (char === ')' && depth === 0) {
      break;
    }
    if (/\s/u.test(char)) {
      break;
    }
    depth += (char === '(' ? 1 : 0) - (char === ')' ? 1 : 0);
  }
  return { after: rest.slice(index), target: rest.slice(first, index) };
}

/**
 * Reads one inline link's destination from the text just after its `](`: an angle-bracketed
 * destination, or a run without spaces whose parentheses balance, then an optional title, then the
 * closing parenthesis. It returns the destination, or undefined when the text is no link.
 */
function inlineDestination(rest) {
  const angled = /^[ \t]*<(?<target>[^>\n]*)>/u.exec(rest);
  const { after, target } =
    angled === null
      ? bareDestination(rest)
      : { after: rest.slice(angled[0].length), target: angled.groups?.target ?? '' };
  const closed = /^(?:[ \t\n]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t\n]*\)/u.test(after);
  return closed ? target : undefined;
}

/**
 * Every link target in one Markdown text, as `{ line, target }` with the 1-based line: inline links
 * and images, whose text may wrap across the lines of a paragraph, and reference definitions.
 */
function extractLinks(text) {
  const links = [];
  let block = [];
  const flush = () => {
    const joined = block.map((entry) => entry.text).join('\n');
    const starts = [];
    let offset = 0;
    for (const entry of block) {
      starts.push(offset);
      offset += entry.text.length + 1;
    }
    for (const match of joined.matchAll(/\]\(/gu)) {
      const before = joined.slice(0, match.index);
      const target = before.includes('[')
        ? inlineDestination(joined.slice(match.index + 2))
        : undefined;
      if (target !== undefined) {
        const at = match.index + 2;
        const row = starts.findLastIndex((start) => start <= at);
        links.push({ line: block[row]?.line ?? 0, target });
      }
    }
    block = [];
  };
  for (const entry of proseLines(text)) {
    const definition = referenceDefinition.exec(entry.text)?.groups;
    if (entry.text.trim() === '') {
      flush();
    } else if (definition !== undefined && !definition.label.startsWith('^')) {
      links.push({ line: entry.line, target: definition.angled ?? definition.bare ?? '' });
    } else {
      block.push(entry);
    }
  }
  flush();
  return links.toSorted((left, right) => left.line - right.line);
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

export { checkLinks, collectAnchors, extractLinks, formatBroken, markdownFiles, slugify };

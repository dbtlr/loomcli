import { dirname, join } from 'node:path/posix';

const bindingComment = /^\s*<!--\s*(?<kind>example|transcript):\s*(?<target>\S+?)\s*-->\s*$/u;
const fenceOpening = /^(?<indent>\s*)(?<fence>`{3,}|~{3,})\s*(?<info>.*)$/u;
const updateCommand = 'UPDATE_GUIDE=1 pnpm vp test --run examples/guide';
const regionMarker = /^\s*\/\/ #(?:region\b.*|endregion)\s*$/u;

/** What a binding comment ties a fence to: a source file or region, or a transcript file. */
interface Binding {
  kind: 'example' | 'transcript';
  /** The line of the comment, counting from 1. */
  line: number;
  /** The path as written, relative to the Markdown file. */
  path: string;
  region?: string;
}

/** One fenced block of a Markdown page. */
interface Fence {
  binding?: Binding;
  /** The body without the fence's indentation. */
  body: string;
  /** The line index, counting from 0, of the closing fence, or of the end of the page. */
  bodyEnd: number;
  /** The line index, counting from 0, of the first body line. */
  bodyStart: number;
  /** Whether a closing fence ended the block. */
  closed: boolean;
  indent: string;
  /** The first word of the info string, or an empty string. */
  language: string;
  /** The line of the opening fence, counting from 1. */
  line: number;
}

/** One reason a page fails; `stale` marks a fence that `UPDATE_GUIDE=1` rewrites. */
interface Problem {
  line: number;
  message: string;
  stale: boolean;
}

/** One failed fence, with the text it should hold when the source can supply one. */
interface Finding {
  line: number;
  message: string;
  rewrite?: string;
}

/** Parses a binding comment line, or returns undefined when the line is anything else. */
function parseBinding(text: string, line: number): Binding | undefined {
  const groups = bindingComment.exec(text)?.groups;
  if (groups?.kind === undefined || groups.target === undefined) {
    return undefined;
  }
  const [path = '', region] = groups.target.split('#');
  return {
    kind: groups.kind === 'example' ? 'example' : 'transcript',
    line,
    path,
    ...(region === undefined || region === '' ? {} : { region }),
  };
}

/** Reads the fence that opens at `index`, with the binding comment on the line above it. */
function readFence(rows: string[], index: number, indent: string, info: string): Fence {
  const opening = fenceOpening.exec(rows[index] ?? '')?.groups?.fence ?? '```';
  const marker = opening.startsWith('`') ? '`' : '~';
  const closing = new RegExp(`^\\s*${marker}{${String(opening.length)},}\\s*$`, 'u');
  let end = index + 1;
  while (end < rows.length && !closing.test(rows[end] ?? '')) {
    end += 1;
  }
  const binding = index > 0 ? parseBinding(rows[index - 1] ?? '', index) : undefined;
  const body = rows
    .slice(index + 1, end)
    .map((row) => (row.startsWith(indent) ? row.slice(indent.length) : row))
    .join('\n');
  return {
    ...(binding === undefined ? {} : { binding }),
    body,
    bodyEnd: end,
    bodyStart: index + 1,
    closed: end < rows.length,
    indent,
    language: info.split(/\s+/u)[0] ?? '',
    line: index + 1,
  };
}

/** Removes the indentation every non-blank line shares. */
function dedent(rows: string[]): string[] {
  const widths = rows
    .filter((row) => row.trim() !== '')
    .map((row) => row.length - row.trimStart().length);
  const common = widths.length === 0 ? 0 : Math.min(...widths);
  return rows.map((row) => row.slice(common));
}

/** A text without its one trailing newline. */
function withoutTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** A whole file as the reader copies it: without its region marker lines. */
function withoutRegionMarkers(text: string): string {
  return text
    .split('\n')
    .filter((row) => !regionMarker.test(row))
    .join('\n');
}

/** Quotes a line for a message, or says there is none. */
function show(row: string | undefined): string {
  return row === undefined ? 'no line' : JSON.stringify(row);
}

/** Names the first line where two texts differ, so a long block still points at its fault. */
function firstDifference(expected: string, found: string): string {
  const wanted = expected.split('\n');
  const have = found.split('\n');
  const at = wanted.findIndex((row, index) => row !== have[index]);
  const line = at === -1 ? wanted.length : at;
  return `first difference at block line ${String(line + 1)}: the source has ${show(wanted[line])} and the page has ${show(have[line])}`;
}

/**
 * Finds every fenced block and the binding comment directly above its opening fence. A binding
 * comment with no fence under it is returned apart, because it binds nothing.
 */
function parseFences(markdown: string): { fences: Fence[]; strayBindings: Binding[] } {
  const rows = markdown.split('\n');
  const fences: Fence[] = [];
  const strayBindings: Binding[] = [];
  let index = 0;
  while (index < rows.length) {
    const opening = fenceOpening.exec(rows[index] ?? '')?.groups;
    if (opening?.fence === undefined) {
      const comment = parseBinding(rows[index] ?? '', index + 1);
      if (comment !== undefined && !fenceOpening.test(rows[index + 1] ?? '')) {
        strayBindings.push(comment);
      }
      index += 1;
    } else {
      const fence = readFence(rows, index, opening.indent ?? '', opening.info ?? '');
      fences.push(fence);
      index = fence.bodyEnd + 1;
    }
  }
  return { fences, strayBindings };
}

/**
 * The lines between `// #region <name>` and the next `// #endregion` in a source, dedented by
 * their common leading indentation. It throws when the region is absent or never closed.
 */
function extractRegion(source: string, region: string): string {
  const rows = source.split('\n');
  const start = rows.findIndex((row) => row.trim() === `// #region ${region}`);
  if (start === -1) {
    throw new Error(`the source has no "// #region ${region}" line`);
  }
  const end = rows.findIndex((row, at) => at > start && row.trim() === '// #endregion');
  if (end === -1) {
    throw new Error(`the region "${region}" has no "// #endregion" line after it`);
  }
  return dedent(rows.slice(start + 1, end)).join('\n');
}

/** The text a bound fence should hold, or the message that says why the binding is wrong. */
function expectedBody(
  binding: Binding,
  target: string,
  read: (path: string) => string | undefined,
): { body: string } | { error: string } {
  const text = read(target);
  if (text === undefined) {
    return {
      error: `"${binding.path}" resolves to ${target}, which does not exist. Fix the path, which is relative to this Markdown file.`,
    };
  }
  if (binding.region === undefined) {
    return { body: withoutTrailingNewline(withoutRegionMarkers(text)) };
  }
  try {
    return { body: extractRegion(text, binding.region) };
  } catch (error) {
    return { error: `${target}: ${error instanceof Error ? error.message : String(error)}.` };
  }
}

/** Judges one fence: undefined when it is fine or needs no binding, else what is wrong with it. */
function inspectFence(
  fence: Fence,
  file: string,
  read: (path: string) => string | undefined,
): Finding | undefined {
  const needsExample = fence.language === 'ts' || fence.language === 'typescript';
  if (!needsExample && fence.language !== 'console') {
    return undefined;
  }
  const wanted = needsExample ? 'example' : 'transcript';
  const { binding } = fence;
  if (!fence.closed) {
    return {
      line: fence.line,
      message: `this ${fence.language} block never closes. Add the closing fence.`,
    };
  }
  if (binding === undefined) {
    return {
      line: fence.line,
      message: `this ${fence.language} block has no binding. Put "<!-- ${wanted}: <path> -->" on the line directly above the opening fence, or use another fence language if the block is not a guide example.`,
    };
  }
  if (binding.kind !== wanted) {
    return {
      line: fence.line,
      message: `a ${fence.language} block takes an "${wanted}" comment and this one has a "${binding.kind}" comment. Change the comment.`,
    };
  }
  const target = join(dirname(file), binding.path);
  const expected = expectedBody(binding, target, read);
  if ('error' in expected) {
    return { line: binding.line, message: expected.error };
  }
  if (expected.body === fence.body) {
    return undefined;
  }
  const source = binding.region === undefined ? target : `${target}#${binding.region}`;
  return {
    line: fence.line,
    message: `this block differs from ${source}; ${firstDifference(expected.body, fence.body)}. Edit the source, or run ${updateCommand} to rewrite the block from it.`,
    rewrite: expected.body,
  };
}

/**
 * Checks every ts, typescript, and console fence of one page against the file it is bound to.
 * `file` and every path `read` receives are repository-relative with forward slashes; `read`
 * returns a file's text, or undefined when there is no such file. `updated` is the page with each
 * stale fence rewritten from its source.
 */
function checkPage({
  file,
  markdown,
  read,
}: {
  file: string;
  markdown: string;
  read: (path: string) => string | undefined;
}): { problems: Problem[]; updated: string } {
  const { fences, strayBindings } = parseFences(markdown);
  const strays = strayBindings.map((stray) => ({
    line: stray.line,
    message: `this ${stray.kind} comment binds no block. Put it on the line directly above the opening fence.`,
  }));
  const found = fences.map((fence) => ({ fence, finding: inspectFence(fence, file, read) }));
  const problems = [...strays, ...found.flatMap(({ finding }) => (finding ? [finding] : []))]
    .toSorted((left, right) => left.line - right.line)
    .map(({ line, message, ...rest }) => ({
      line,
      message: `${file}:${String(line)}: ${message}`,
      stale: 'rewrite' in rest,
    }));
  const rows = markdown.split('\n');
  // Rewrites run from the last fence to the first, so the earlier line indexes stay valid.
  for (const { fence, finding } of found.toReversed()) {
    if (finding?.rewrite !== undefined) {
      const body =
        finding.rewrite === ''
          ? []
          : finding.rewrite.split('\n').map((row) => `${fence.indent}${row}`);
      rows.splice(fence.bodyStart, fence.bodyEnd - fence.bodyStart, ...body);
    }
  }
  return { problems, updated: rows.join('\n') };
}

export { checkPage, extractRegion, parseFences };
export type { Binding, Fence, Problem };

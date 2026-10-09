import { createHash } from 'node:crypto';

/** The header line of a managed file, which records the checksum of the file's content. */
const header = /^<!-- Managed by loom init\. sha256:(?<checksum>[\da-f]{64}) -->$/u;

/** YAML frontmatter at the start of a file: a `---` line, its body, and a closing `---` line. */
const frontmatter = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/u;

/** The empty lines at the start of a text. */
const blankLines = /^(?:\r?\n)*/u;

/**
 * The files `loom init` manages, by path under the package directory: the fragment guide and the
 * changelog skill.
 */
export const managedFiles = [
  '.changes/README.md',
  '.agents/skills/loom-changelog/SKILL.md',
] as const;

/** A managed file read apart: the checksum its header records and its content without the header. */
export interface ManagedFile {
  readonly checksum: string;
  readonly content: string;
}

/**
 * Reads a managed file's header. The header is the file's first line, or, when the file opens with
 * YAML frontmatter, the first non-blank line after the closing `---` line, because a Markdown
 * formatter separates the frontmatter from the next block with a blank line. The content without
 * the header is the file's whole text with exactly that line and its line ending, `\n` or `\r\n`,
 * removed, so the frontmatter, the blank lines before the header, and every byte after it stay. The
 * checksum a header records covers that content with each CRLF read as LF, so a checkout that
 * converts line endings, as `core.autocrlf=true` does, does not read as drift. A file whose header
 * line is not a managed header is not managed, and reads `undefined`.
 */
export function readManaged(text: string): ManagedFile | undefined {
  const opening = frontmatter.exec(text)?.[0].length;
  const start =
    opening === undefined ? 0 : opening + (blankLines.exec(text.slice(opening))?.[0].length ?? 0);
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline + 1;
  const line = text.slice(start, end).replace(/\r?\n$/u, '');
  const checksum = header.exec(line)?.groups?.checksum;
  if (checksum === undefined) {
    return undefined;
  }
  return { checksum, content: text.slice(0, start) + text.slice(end) };
}

/**
 * The checksum a header records for content: the SHA-256 of its UTF-8 bytes with each CRLF read as
 * LF, in lowercase hex.
 */
export function managedChecksum(content: string): string {
  return createHash('sha256').update(content.replaceAll('\r\n', '\n'), 'utf8').digest('hex');
}

/**
 * A managed file's text for its content: the header on the first line, or, when the content opens
 * with YAML frontmatter, after the frontmatter and the one blank line that follows it in the
 * content, so a Markdown formatter finds the blank line it would insert already there. The header
 * records the checksum of the content itself, so `readManaged` reads the content back exactly and
 * finds it undrifted.
 */
export function renderManaged(content: string): string {
  const opening = frontmatter.exec(content)?.[0].length;
  const start =
    opening === undefined ? 0 : opening + (/^\r?\n/u.exec(content.slice(opening))?.[0].length ?? 0);
  const line = `<!-- Managed by loom init. sha256:${managedChecksum(content)} -->`;
  return `${content.slice(0, start)}${line}\n${content.slice(start)}`;
}

/**
 * The warning a managed file draws once its content no longer matches its header, which `loom
 * check` and `loom init` print alike.
 */
export function driftWarning(path: string) {
  return `warning: ${path} differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.`;
}

/** Whether a managed file has drifted: its content no longer matches the checksum its header records. */
export function hasDrifted(file: ManagedFile): boolean {
  return managedChecksum(file.content) !== file.checksum;
}

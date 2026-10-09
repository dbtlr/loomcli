import { createHash } from 'node:crypto';

/** The header line of a managed file, which records the checksum of the file's content. */
const header = /^<!-- Managed by loom init\. sha256:(?<checksum>[\da-f]{64}) -->$/u;

/** YAML frontmatter at the start of a file: a `---` line, its body, and a closing `---` line. */
const frontmatter = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/u;

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
 * YAML frontmatter, the first line after the closing `---` line. The content without the header is
 * the file's whole text with exactly that line and its line ending, `\n` or `\r\n`, removed, so the
 * frontmatter and every byte after the header stay, the blank line that usually follows it
 * included. A file whose header line is not a managed header is not managed, and reads `undefined`.
 */
export function readManaged(text: string): ManagedFile | undefined {
  const start = frontmatter.exec(text)?.[0].length ?? 0;
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline + 1;
  const line = text.slice(start, end).replace(/\r?\n$/u, '');
  const checksum = header.exec(line)?.groups?.checksum;
  if (checksum === undefined) {
    return undefined;
  }
  return { checksum, content: text.slice(0, start) + text.slice(end) };
}

/** The checksum a header records for content: the SHA-256 of its UTF-8 bytes, in lowercase hex. */
export function managedChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Whether a managed file has drifted: its content no longer matches the checksum its header records. */
export function hasDrifted(file: ManagedFile): boolean {
  return managedChecksum(file.content) !== file.checksum;
}

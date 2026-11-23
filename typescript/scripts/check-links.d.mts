/** One link target found in a Markdown text, with the 1-based line it stands on. */
export interface FoundLink {
  readonly line: number;
  readonly target: string;
}

/** One link that does not resolve. */
export interface BrokenLink extends FoundLink {
  readonly file: string;
  readonly reason: 'no such anchor' | 'no such file';
}

export function slugify(text: string): string;
export function collectAnchors(text: string): Set<string>;
export function extractLinks(text: string): FoundLink[];
export function checkLinks(root: string, files: readonly string[]): BrokenLink[];
export function formatBroken(broken: readonly BrokenLink[]): string[];
export function markdownFiles(root: string): string[];

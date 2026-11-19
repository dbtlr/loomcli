import { sep } from 'node:path';

/**
 * How one real path stands to another: the same, inside it, holding it, or apart. A root, such as
 * `/` or `C:\`, already ends in its separator, so it is not given a second one.
 */
function relationOf(
  path: string,
  other: string,
  separator: string = sep,
): 'is' | 'is inside' | 'holds' | undefined {
  if (path === other) {
    return 'is';
  }
  if (path.startsWith(asFolder(other, separator))) {
    return 'is inside';
  }
  return other.startsWith(asFolder(path, separator)) ? 'holds' : undefined;
}

/** A path with one separator at its end, so that only what lies inside it starts with it. */
function asFolder(path: string, separator: string): string {
  return path.endsWith(separator) ? path : `${path}${separator}`;
}

export { relationOf };

/**
 * A path split at the last `.` of its last segment, where segments split on `/` and `\`: the stem
 * before the dot and the extension after it. The dot never starts the name, so `.textstatrc` and
 * `.toml` have no extension.
 */
const extended = /^(?<stem>(?:.*[/\\])?[^/\\]+)\.(?<extension>[^./\\]*)$/su;

/** A path's stem and extension, or `undefined` when its name has no extension. */
export function splitExtension(path: string): { stem: string; extension: string } | undefined {
  const parts = extended.exec(path)?.groups;
  const stem = parts?.stem;
  const extension = parts?.extension;
  return stem === undefined || extension === undefined ? undefined : { extension, stem };
}

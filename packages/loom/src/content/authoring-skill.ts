import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteLinkTargets } from '../helpers/markdown-links.js';

/** The folder of the authoring skill in this repository, from the repository root. */
const authoringSkillSource = 'packages/loom/skills/loom';

/** The repository the skill's links into the repository name, which `package.json` also names. */
const repositoryUrl = 'https://github.com/dbtlr/loomcli';

/** A target that opens with a URL scheme (`https:`, `mailto:`), is protocol-relative, or is absolute. */
const notRelative = /^(?:[a-z][a-z0-9+.-]*:|\/)/iu;

/** YAML frontmatter at the start of a file: a `---` line, its body, and a closing `---` line. */
const frontmatter = /^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n/u;

/**
 * The skill folder `loom init` reads. A built `loom` runs from `dist`, with the folder beside it, and
 * a run from source sits in `src/content`, with the folder two levels up, so the first candidate that
 * exists is the one the running copy ships.
 */
function skillFolder(): string {
  const built = fileURLToPath(new URL('../skills/loom/', import.meta.url));
  return existsSync(built) ? built : fileURLToPath(new URL('../../skills/loom/', import.meta.url));
}

/** The paths of every file under a folder, relative to it with `/` separators, sorted. */
function filesUnder(folder: string, prefix = ''): string[] {
  return readdirSync(join(folder, prefix), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(folder, `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .toSorted();
}

/**
 * One link target of the skill's source file at `path`, rendered for the running version. A target
 * that is relative and resolves outside the skill folder names the file at that version's tag, with
 * its `#fragment`; every other target stays as written.
 */
function renderedTarget(path: string, version: string, target: string): string {
  const clean = target.trim();
  if (clean === '' || clean.startsWith('#') || notRelative.test(clean)) {
    return target;
  }
  const hash = clean.indexOf('#');
  const file = hash === -1 ? clean : clean.slice(0, hash);
  const resolved = posix.join(authoringSkillSource, posix.dirname(path), file);
  if (resolved.startsWith('../') || resolved.startsWith(`${authoringSkillSource}/`)) {
    return target;
  }
  return `${repositoryUrl}/blob/v${version}/${resolved}${hash === -1 ? '' : clean.slice(hash)}`;
}

/**
 * The text of a skill file with its repository links rendered for a version: each link to a file
 * outside the skill folder names that file at the version's tag.
 */
function renderSkillLinks(text: string, path: string, version: string): string {
  return rewriteLinkTargets(text, (target) => renderedTarget(path, version, target));
}

/**
 * A skill file as `loom init` manages it, without its header. `SKILL.md` gets a second blank line
 * after its frontmatter, and any other file a blank first line, so the header lands between two
 * blank lines, as in the changelog skill and the fragment guide.
 */
function managedContent(text: string): string {
  const opening = frontmatter.exec(text)?.[0];
  if (opening === undefined) {
    return `\n${text}`;
  }
  return `${opening}\n${text.slice(opening.length).replace(/^(?:\r?\n)+/u, '\n')}`;
}

/**
 * The authoring skill `loom init` manages at `.agents/skills/loom/`, as each file's path below that
 * folder and its content without the header, with its repository links rendered at the tag of the
 * given version. The skill is Markdown written by hand and read from the package's `skills` folder.
 */
function authoringSkill(version: string): { content: string; path: string }[] {
  const folder = skillFolder();
  return filesUnder(folder).map((path) => {
    const source = readFileSync(join(folder, path), 'utf8');
    return { content: managedContent(renderSkillLinks(source, path, version)), path };
  });
}

export { authoringSkill, authoringSkillSource, renderSkillLinks, repositoryUrl };

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';

import { withoutByteOrderMark } from './byte-order-mark.js';
import { requireClosedBlocks } from './markdown.js';
import { readDirectory, readRegularFile } from './repository.js';
import type { Checkout } from './repository.js';

// Undefined for a name outside the grammar: a bare kind prefix, an empty slug, or another extension.
function fragmentKind(name: string): FragmentKind | undefined {
  if (!name.endsWith('.md') || name === '.md') {
    return undefined;
  }
  const stem = name.slice(0, -'.md'.length);
  for (const kind of ['breaking', 'feature'] satisfies FragmentKind[]) {
    if (stem === kind) {
      return undefined;
    }
    if (stem.startsWith(`${kind}.`)) {
      return stem.length > kind.length + 1 ? kind : undefined;
    }
  }
  return 'fix';
}

function validateBody(name: string, kind: FragmentKind, body: string) {
  requireClosedBlocks(body, `.changes/${name}`);
  const nodes = fromMarkdown(body).children;
  const migrationIndex = nodes.findIndex((node) => node.type === 'heading');
  const breaking = kind === 'breaking';
  const bullets = breaking && migrationIndex !== -1 ? nodes.slice(0, migrationIndex) : nodes;
  if (
    bullets.length === 0 ||
    bullets.some(
      (node) =>
        node.type !== 'list' ||
        node.ordered ||
        node.children.some((item) => item.children.length === 0),
    )
  ) {
    throw new Error(`.changes/${name}: expected top-level change bullets.`);
  }
  if (!breaking) {
    return;
  }
  const heading = nodes[migrationIndex];
  if (
    heading?.type !== 'heading' ||
    heading.depth !== 3 ||
    heading.children.length !== 1 ||
    heading.children[0]?.type !== 'text' ||
    heading.children[0].value !== 'Migration'
  ) {
    throw new Error(`.changes/${name}: expected one ### Migration section after the bullets.`);
  }
  const migrationNodes = nodes.slice(migrationIndex + 1);
  if (migrationNodes.some((node) => node.type === 'heading')) {
    throw new Error(`.changes/${name}: expected one ### Migration section.`);
  }
  const labels = ['Affected surface.', 'Why.', 'Before and after.', 'Steps.', 'Validation.'];
  const found = migrationNodes.flatMap((node) => {
    const first = node.type === 'paragraph' ? node.children[0] : undefined;
    if (
      first?.type !== 'strong' ||
      first.children.length !== 1 ||
      first.children[0]?.type !== 'text'
    ) {
      return [];
    }
    return labels.includes(first.children[0].value) ? [first.children[0].value] : [];
  });
  if (labels.some((label) => found.filter((item) => item === label).length !== 1)) {
    throw new Error(`.changes/${name}: Migration requires each label once: ${labels.join(', ')}`);
  }
}

// One fragment, read and validated. An invalid entry throws the sentence that names it.
async function readFragment(
  checkout: Checkout,
  entry: Awaited<ReturnType<typeof readDirectory>>[number],
  ref: string | undefined,
) {
  const { name } = entry;
  if (!entry.isFile()) {
    throw new Error(
      `.changes/${name}: expected a fragment file. Keep fragments directly in .changes/.`,
    );
  }
  const kind = fragmentKind(name);
  if (kind === undefined) {
    throw new Error(
      `.changes/${name}: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.`,
    );
  }
  const source = await readRegularFile(checkout, `.changes/${name}`, ref);
  const body = withoutByteOrderMark(source);
  validateBody(name, kind, body);
  return { body, kind, name, source };
}

/** A fragment's kind, read from its file name: `breaking.<slug>.md`, `feature.<slug>.md`, or `<slug>.md`. */
export type FragmentKind = 'breaking' | 'feature' | 'fix';

/**
 * Every fragment in `.changes/` under the root, read from the working tree or from a revision.
 * The regular file `README.md` is the guide, not a fragment. A hidden entry, one whose name starts
 * with `.`, is ignored, and a missing working-tree directory holds no fragments. One error names
 * every invalid entry, so a single run reports them all.
 */
export async function readFragments(checkout: Checkout, ref?: string) {
  if (ref === undefined && !existsSync(join(checkout.root, '.changes'))) {
    return [];
  }
  const failures: string[] = [];
  const fragments = [];
  const listed = await readDirectory(checkout, '.changes', ref);
  const entries = listed
    .filter((entry) => !entry.name.startsWith('.'))
    .filter((entry) => entry.name !== 'README.md' || !entry.isFile());
  for (const entry of entries) {
    try {
      fragments.push(await readFragment(checkout, entry, ref));
    } catch (error) {
      // A cancelled run reads no further fragment and reports none.
      checkout.signal.throwIfAborted();
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  return fragments;
}

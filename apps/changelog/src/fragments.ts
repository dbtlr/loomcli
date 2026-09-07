import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';

import { requireClosedBlocks } from './markdown.js';

function validateBody(name: string, body: string) {
  requireClosedBlocks(body, `.changes/${name}`);
  const nodes = fromMarkdown(body).children;
  const migrationIndex = nodes.findIndex((node) => node.type === 'heading');
  const breaking = name.startsWith('breaking.');
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

export function readFragments(root: string) {
  return readdirSync(join(root, '.changes'), { withFileTypes: true })
    .filter((entry) => entry.name !== 'README.md' || !entry.isFile())
    .map((entry) => {
      const { name } = entry;
      if (
        !entry.isFile() ||
        !/^.+\.md$/u.test(name) ||
        name === 'breaking.md' ||
        name === 'breaking..md'
      ) {
        throw new Error(`.changes/${name}: expected <slug>.md or breaking.<slug>.md.`);
      }
      const body = readFileSync(join(root, '.changes', name), 'utf8');
      validateBody(name, body);
      return { body, breaking: name.startsWith('breaking.'), name };
    });
}

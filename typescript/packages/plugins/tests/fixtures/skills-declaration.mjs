// JavaScript intentionally supplies loader results and files that the public types reject.
import { appendFileSync } from 'node:fs';

import { skills } from '@loomcli/plugins/skills';

function skillsDeclaration(entries, loaded) {
  return skills({
    skills: entries.map((entry) => ({
      files: async () => {
        appendFileSync(loaded, `${entry.name}\n`);
        if (entry.throws) {
          throw new Error(`The ${entry.name} loader failed.`);
        }
        return 'result' in entry ? entry.result : entry.files.map(fileOf);
      },
      name: entry.name,
    })),
  });
}

function fileOf({ bytes, content, executable, path }) {
  return {
    content: bytes === undefined ? content : Uint8Array.from(bytes),
    ...(executable === undefined ? {} : { executable }),
    path,
  };
}

export { skillsDeclaration };

import { Application, Command } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';

export function makeApplication(description = 'Keep notes.') {
  return new Application('notes', {
    description,
    plugins: [
      skills({
        skills: [
          {
            commands: [[]],
            files: () => [
              { content: '# Notes\n', path: 'SKILL.md' },
              { content: '#!/bin/sh\n', executable: true, path: 'scripts/run.sh' },
              { content: new Uint8Array([0, 255, 128]), path: 'asset.bin' },
            ],
            name: 'notes',
          },
          { files: () => [{ content: '# Other\n', path: 'SKILL.md' }], name: 'other' },
        ],
      }),
    ],
  }).command(new Command('list', { description: 'List notes.' }).action(() => {}));
}

export const application = makeApplication();

import { Application, processHandle } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills, skills } from '@loomcli/plugins/skills';
import type { RefreshContext, Skill, SkillFile, SkillsSettings } from '@loomcli/plugins/skills';

// The packed skills plugin compiles against its declaration.
// `refreshSkills` is an `afterReplace` function for the packed self-update plugin.
// A run with a relative HOME refuses before it loads a skill or reads the record.
const files: readonly SkillFile[] = [{ content: '# Packed\n', path: 'SKILL.md' }];
const packed: Skill = { files: () => files, name: 'packed' };
const settings: SkillsSettings = { skills: [packed] };
const refresh: (context: RefreshContext) => Promise<void> = refreshSkills;

const app = new Application('packed-skills', {
  description: 'Install skills from the packed plugin.',
  plugins: [skills(settings), selfUpdate({ afterReplace: refresh })],
});

process.exitCode = await app.run({
  process: processHandle({
    argv: ['skills', 'install'],
    env: { HOME: 'relative' },
    // A supplied home wins, so the relative one reaches the plugin rather than the user database's.
    home: 'relative',
    platform: 'linux',
  }),
});

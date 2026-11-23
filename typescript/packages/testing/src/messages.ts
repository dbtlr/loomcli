import { escapeControlCharacters } from '@loomcli/core';

const singular = 1;

export const pluginsMissing =
  'Cannot check skills without @loomcli/plugins. Install @loomcli/plugins beside @loomcli/testing, then run the test again.';
export const skillsUnavailable =
  'The application records no skills plugin. Declare skills() with a current @loomcli/plugins, then run the test again.';
export const noSkills =
  'The application declares no skills. Add a skill to skills(), then run the test again.';
export function skillDiff(path: string): string {
  return `Committed skill differs at "${escapeControlCharacters(path)}". Run loom skills export for this directory and commit the updated copy.`;
}

export function assemblyLead(count: number): string {
  return `The application does not assemble: ${escapeControlCharacters(String(count))} ${count === singular ? 'fault' : 'faults'}.`;
}

export const pluginsExportMissing =
  '@loomcli/plugins exports no skillFolders function. Install @loomcli/plugins and @loomcli/testing at one version, then run the test again.';
export const pluginsFoldersInvalid =
  '@loomcli/plugins returned skill folders in an unreadable shape. Install @loomcli/plugins and @loomcli/testing at one version, then run the test again.';
export function unknownSkill(name: string): string {
  return `Skill "${escapeControlCharacters(name)}" is not declared. Name a declared skill in options.skills or omit options.skills to check all skills.`;
}

export function unstatedMember(builder: string, member: string): string {
  return `${escapeControlCharacters(builder)} has no ${escapeControlCharacters(member)}. Add ${escapeControlCharacters(member)} to its values.`;
}

export function unstatedViewMeasure(member: string): string {
  return `viewContext has no ${escapeControlCharacters(member)} for this view to call. Add ${escapeControlCharacters(member)} to its values.`;
}

export function unstatedActionInvoke(path: string): string {
  return `actionContext has no invoke for "${escapeControlCharacters(path)}". Add invoke to its values, such as invoke: async () => ({ status: 'completed', output: '', messages: '' }).`;
}

export function unstatedMiddlewareNext(): string {
  return "middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.";
}

export function unstatedOutText(builder: string, kind: string): string {
  return `${escapeControlCharacters(builder)} has no out.text for this ${escapeControlCharacters(kind)} to read. Add text to its out values, such as out: { text: () => 'page\\n' }.`;
}

export function unscriptedProgram(command: string): string {
  return `mockProcess has no program for "${escapeControlCharacters(command)}". Add a "${escapeControlCharacters(command)}" entry to programs.`;
}

/*
 * The unit files the plugin writes: a systemd user unit on Linux and a launchd property list on
 * macOS. Each is the contract's text with its values substituted, ending in one newline.
 */

/** What a unit file holds: its label, the words it runs, its working directory, and its description. */
interface UnitValues {
  readonly label: string;
  readonly words: readonly string[];
  readonly home: string;
  readonly description: string;
}

/** A value systemd expands no specifier in: every `%` doubled. */
function withoutSpecifiers(value: string): string {
  return value.replaceAll('%', '%%');
}

/** One `ExecStart` word, wrapped in `"` with `\`, `"`, and `$` escaped and `%` doubled. */
function execWord(word: string): string {
  const escaped = word
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`)
    .replaceAll('$', '$$$$');
  return `"${withoutSpecifiers(escaped)}"`;
}

/** The systemd user unit that runs the words from the home directory and always restarts them. */
function systemdUnit(values: UnitValues): string {
  return [
    '[Unit]',
    `Description=${withoutSpecifiers(values.description)}`,
    'StartLimitIntervalSec=0',
    '',
    '[Service]',
    `ExecStart=${values.words.map(execWord).join(' ')}`,
    `WorkingDirectory=${withoutSpecifiers(values.home)}`,
    'Restart=always',
    'RestartSec=10',
    'SuccessExitStatus=130 143',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** The XML entity of each character a property list value escapes. */
const entities: Readonly<Record<string, string>> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&apos;',
  '<': '&lt;',
  '>': '&gt;',
};

/** A property list value with `&`, `<`, `>`, `"`, and `'` written as XML entities. */
function xmlText(value: string): string {
  return value.replaceAll(/["&'<>]/gu, (character) => entities[character] ?? character);
}

/** The launchd user agent that runs the words from the home directory and keeps them alive. */
function launchdPlist(values: UnitValues): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlText(values.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...values.words.map((word) => `    <string>${xmlText(word)}</string>`),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xmlText(values.home)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>ThrottleInterval</key>',
    '  <integer>10</integer>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export type { UnitValues };
export { launchdPlist, systemdUnit };

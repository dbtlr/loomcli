/*
 * The unit files the plugin writes: a systemd user unit on Linux and a launchd property list on
 * macOS. Each is the contract's text with its values substituted, ending in one newline.
 */

const millisecondsPerSecond = 1000;

/** The resolved values for either platform's unit file. */
interface UnitValues {
  readonly label: string;
  readonly words: readonly string[];
  readonly home: string;
  readonly description: string;
  readonly environment: readonly (readonly [name: string, value: string])[];
  readonly output: string | undefined;
  readonly stopTimeout: number | undefined;
}

/** A value systemd expands no specifier in: every `%` doubled. */
function withoutSpecifiers(value: string): string {
  return value.replaceAll('%', '%%');
}

/** One systemd item, with quotes around the whole item and C-style escapes inside it. */
function systemdWord(word: string): string {
  const escaped = word.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${withoutSpecifiers(escaped)}"`;
}

/** One `ExecStart` word, wrapped in `"` with `\`, `"`, and `$` escaped and `%` doubled. */
function execWord(word: string): string {
  return systemdWord(word.replaceAll('$', () => '$$'));
}

/** Environment assignments use systemd's item syntax and keep dollar signs literal. */
function environmentLine([name, value]: readonly [string, string]): string {
  const assignment = systemdWord(`${name}=${value}`)
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\r', String.raw`\r`)
    .replaceAll('\t', String.raw`\t`);
  return `Environment=${assignment}`;
}

/** The systemd user unit that runs the words from the home directory and always restarts them. */
function systemdUnit(values: UnitValues): string {
  // The append directive consumes the rest of the line as a path, with no quote or escape parsing.
  const output =
    values.output === undefined
      ? []
      : [
          `StandardOutput=append:${withoutSpecifiers(values.output)}`,
          `StandardError=append:${withoutSpecifiers(values.output)}`,
        ];
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
    ...values.environment.map(environmentLine),
    ...output,
    ...(values.stopTimeout === undefined ? [] : [`TimeoutStopSec=${BigInt(values.stopTimeout)}ms`]),
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
  const environment = values.environment.length
    ? [
        '  <key>EnvironmentVariables</key>',
        '  <dict>',
        ...values.environment.flatMap(([name, value]) => [
          `    <key>${xmlText(name)}</key>`,
          `    <string>${xmlText(value).replaceAll('\r', '&#13;')}</string>`,
        ]),
        '  </dict>',
      ]
    : [];
  const output =
    values.output === undefined
      ? []
      : [
          '  <key>StandardOutPath</key>',
          `  <string>${xmlText(values.output)}</string>`,
          '  <key>StandardErrorPath</key>',
          `  <string>${xmlText(values.output)}</string>`,
        ];
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
    ...environment,
    ...output,
    ...(values.stopTimeout === undefined
      ? []
      : [
          '  <key>ExitTimeOut</key>',
          `  <integer>${BigInt(Math.ceil(values.stopTimeout / millisecondsPerSecond))}</integer>`,
        ]),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export type { UnitValues };
export { launchdPlist, systemdUnit };

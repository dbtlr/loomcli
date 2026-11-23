import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { Program } from '@loomcli/testing';
import { z } from 'zod';

interface Answer {
  readonly exit?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly abort?: boolean;
}

/** The same scripted manager answers as the process fixture, without starting a manager. */
export function servicePrograms(scenario: {
  bin: string;
  calls: string;
  abortMarker: string;
  answers: readonly { call: string; results: readonly Answer[] }[];
}): Record<string, Program> {
  const programs: Record<string, Program> = {};
  for (const name of ['systemctl', 'loginctl', 'launchctl']) {
    const program: Program = async (call) => {
      if (!(call.env.PATH ?? '').split(':').includes(scenario.bin)) {
        throw new Error(`No ${name} on the fixture PATH.`);
      }
      accessSync(join(scenario.bin, name), constants.X_OK);
      const words = [name, ...call.args].join(' ');
      appendFileSync(
        scenario.calls,
        `${JSON.stringify({ runtime: call.env.XDG_RUNTIME_DIR ?? null, words })}\n`,
      );
      const countsPath = `${scenario.calls}.counts`;
      const counts = existsSync(countsPath)
        ? z.record(z.string(), z.number()).parse(JSON.parse(readFileSync(countsPath, 'utf8')))
        : {};
      const rule = scenario.answers.find((each) => each.call === words);
      const used = counts[words] ?? 0;
      const answer =
        rule === undefined ? { exit: 0 } : rule.results[Math.min(used, rule.results.length - 1)];
      if (answer === undefined) {
        throw new Error(`No scripted answer for ${words}.`);
      }
      counts[words] = used + 1;
      writeFileSync(countsPath, JSON.stringify(counts));
      if (answer.abort === true) {
        writeFileSync(scenario.abortMarker, '');
      }
      return {
        code: answer.exit ?? 0,
        stderr: answer.stderr ?? 'manager diagnostics\n',
        stdout: answer.stdout ?? 'manager output\n',
      };
    };
    programs[name] = program;
    programs[join(scenario.bin, name)] = program;
  }
  return programs;
}

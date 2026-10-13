import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * A fake service manager program: `systemctl`, `loginctl`, or `launchctl`, as the wrapper script on
 * `PATH` names it. It appends its words and the `XDG_RUNTIME_DIR` it received to the scenario's call
 * log, then answers from the scenario: the first rule whose `call` is its words exactly gives a list
 * of answers taken in turn, the last one repeating. A call no rule names exits 0 and prints nothing.
 */
const [scenarioPath, program, ...args] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const words = [program, ...args].join(' ');

appendFileSync(
  scenario.calls,
  `${JSON.stringify({ runtime: process.env.XDG_RUNTIME_DIR ?? null, words })}\n`,
);

/** How many times each rule has answered, kept beside the call log. */
const countsPath = `${scenario.calls}.counts`;
const counts = existsSync(countsPath) ? JSON.parse(readFileSync(countsPath, 'utf8')) : {};

const rule = (scenario.answers ?? []).find((each) => each.call === words);
const used = counts[words] ?? 0;
const answer =
  rule === undefined ? { exit: 0 } : rule.results[Math.min(used, rule.results.length - 1)];
counts[words] = used + 1;
writeFileSync(countsPath, JSON.stringify(counts));

if (answer.abort === true) {
  writeFileSync(scenario.abortMarker, '');
}
if (answer.hang === true) {
  // The call never exits on its own, so only the run signal's SIGTERM ends it.
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(answer.stdout ?? 'manager output\n');
  process.stderr.write(answer.stderr ?? 'manager diagnostics\n');
  process.exitCode = answer.exit ?? 0;
}

// Bun's startup dotenv read is the reference, before any Application or plugin can run.
const names = JSON.parse(process.env.FIXTURE_NAMES ?? '["TOKEN"]');
const observed = Object.fromEntries(names.map((name) => [name, process.env[name]]));
process.stdout.write(JSON.stringify(observed));

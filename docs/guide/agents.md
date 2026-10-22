---
description: "Guide chapter 7. Install the manifest and MCP plugins so an agent reads pace from its declarations, declare the failures a Command raises, and run a Command by name with invoke()."
---

# Agents

In this chapter you make `pace` ready for agents. At the end, `pace convert --manifest` prints a JSON description of `convert` that an agent reads before it runs the Command, `pace mcp` serves `calc`, `splits`, and `convert` as tools to an MCP client, and a TypeScript function runs `pace calc` by name and returns what the run wrote.

An agent that runs `pace` is an [operator](../glossary.md#people), as a person at a terminal is, and Loom holds that [an agent reads the same facts a person does](../principles.md#2-the-operators-experience-is-the-product). Loom builds those facts from your declarations into one structure, the [command graph](../glossary.md#compilation-and-invocation). A surface that reads the graph is a [projection](../glossary.md#product-surface), and the help page you have read since chapter 1 is one. This chapter adds two more projections: the manifest and the MCP tool listing. Neither one asks you to describe `pace` a second time, so an agent can use `pace` correctly without having been trained on it.

## Install the plugins

This chapter changes these files:

- `src/commands/calc.ts` and `src/scripts/pace-for.ts` are shown below, with the parts of `src/application.ts` and `src/commands/splits.ts` that change.
- `src/application.ts`: copy it from [the snapshot](../../examples/guide/src/07-agents/application.ts). It imports and installs the two plugins.
- `src/commands/splits.ts`: copy it from [the snapshot](../../examples/guide/src/07-agents/commands/splits.ts). It imports `manifestCommand`, `mcpCommand`, and `SplitTooLongError`.
- `src/commands/convert.ts`: copy it from [the snapshot](../../examples/guide/src/07-agents/commands/convert.ts). It gains the `mcpCommand` value that `calc` gains.

Import `manifest` from `@loomcli/plugins/manifest` and `mcp` from `@loomcli/plugins/mcp`, and add both to the Application's `plugins` list in `src/application.ts`:

<!-- example: ../../examples/guide/src/07-agents/application.ts#plugins -->
```ts
// Installation order is composition order: help and version answer before any later plugin.
plugins: [
  help(),
  suggestions(),
  version(),
  format(),
  manifest(),
  config(),
  completion(),
  mcp(),
  raceHint(),
],
```

- **`manifest()`** declares one global option, `--manifest`, which prints the manifest of the routed Command. The [manifest plugin](../plugins/manifest.md) describes the option and the document.
- **`mcp()`** contributes one [plugin Command](../core/plugin-contract.md#plugin-commands), `mcp`, which serves `pace`'s Commands to an MCP client. The [MCP plugin](../plugins/mcp.md) describes the server.

The help page now lists the `mcp` Command and the `--manifest` option:

<!-- transcript: ../../examples/guide/transcripts/07-agents/help.txt -->
```console
$ pace --help
pace · Work out running paces, splits, and conversions.

USAGE
  pace <command> [options]

COMMANDS
  completion <command>  Print or install a shell completion script.
  mcp                   Serve this application's tools to an MCP client over stdin and stdout.
  calc                  Work out the pace of a run.
  splits                List the time of each split of a run.
  convert               Give a pace per kilometre as a pace per mile, or the other way round.
  races                 List the races pace knows by name.

GLOBAL OPTIONS
  -u, --unit <unit>      The unit to give a pace in. One of: km, mi.  (default: km)
  -h, --help             Show this help.
  -V, --version          Print the version.
      --manifest         Print this command's manifest as JSON.
      --config <config>  Read configuration from this file alone.

Run pace <command> --help for command details.
```

`--manifest`, `--help`, `--version`, and `--config` are [control options](../core/commands.md#control-options): each one controls the invocation rather than feeding the Command's work. Each plugin marks its own option with `control: true`. Help lists a control option like any other option, and the MCP tool listing, later in this chapter, leaves it out.

## Read a Command's manifest

`--manifest` prints the manifest of the routed Command as JSON, and the run exits 0 without running the action. So `pace convert --manifest` prints although it supplies no pace.

The document is the slice of the graph for `convert`, with the facts an agent needs to call it in one place. Most of its lines describe the global options, so read these fields first:

- **The envelope.** `name`, `version`, and `description` are the Application's. `tokens` states once how to read every schema in the document: each input is a string token, and a `null` schema means that the accepted shape is unknown. `encodings` states what the `json` and `jsonl` media types promise.
- **`exitCodes`.** The table holds core's codes and a row for each code a declared failure carries anywhere in the application. Row `64` names `split-too-long`, the failure code of `SplitTooLongError` from chapter 5, which `splits` declares in the next section. It appears in `convert`'s slice too, because the table covers the whole application.
- **`globals`.** Every global option, in order. `unit` carries the schema its `oneOf` validator publishes, the `PACE_UNIT` variable, and its default. Each plugin's option reads `control: true`.
- **`command`.** `convert`'s own entry. `result` says that `convert` produces a value, that its views are `text`, `json`, and `jsonl`, and which views declare a JSON media type, so an agent knows that `--format json` gives it JSON. The `pace` argument carries its description and the input schema that its validator publishes, here the pattern you wrote in chapter 3. `--format` is a local option with `control: true`.

<details>
<summary>The whole manifest of <code>pace convert</code></summary>

<!-- transcript: ../../examples/guide/transcripts/07-agents/convert-manifest.txt -->
```console
$ pace convert --manifest
{
  "name": "pace",
  "version": "0.0.0",
  "description": "Work out running paces, splits, and conversions.",
  "tokens": "Every input is a string token. A schema describes the value one token must satisfy, and each token of a multiple option or a variadic argument satisfies it alone. A null schema means the accepted shape is unknown, not that every token is accepted. An example's command holds the tokens after the application name.",
  "exitCodes": {
    "0": "Successful execution and core output",
    "1": "Expected action failure, internal failure, or invalid declarations",
    "2": "Invalid invocation inputs",
    "64": "Declared failures: split-too-long",
    "130": "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
    "141": "Stopped because the reader of stdout closed the pipe",
    "143": "Cancelled by SIGTERM"
  },
  "encodings": {
    "json": "The output is one JSON document. Unless the Command's view reshapes it, a value result is the value and a rows result is the array of its rows.",
    "jsonl": "Each line is one JSON document: one line per element when the printed value is an array, nothing for an empty array, and one line otherwise. Unless the view reshapes it, a rows result prints one line per row."
  },
  "globals": [
    {
      "type": "string",
      "name": "unit",
      "description": "The unit to give a pace in.",
      "deprecated": null,
      "control": false,
      "long": "--unit",
      "short": "-u",
      "required": false,
      "requiredWhen": null,
      "multiple": false,
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string",
        "enum": [
          "km",
          "mi"
        ]
      },
      "env": [
        "PACE_UNIT"
      ],
      "default": {
        "value": "km"
      },
      "implied": null,
      "background": false
    },
    {
      "type": "boolean",
      "name": "help",
      "description": "Show this help.",
      "deprecated": null,
      "control": true,
      "long": "--help",
      "short": "-h",
      "negative": null,
      "polarity": "positive",
      "interaction": false,
      "color": false,
      "schema": null,
      "env": []
    },
    {
      "type": "boolean",
      "name": "version",
      "description": "Print the version.",
      "deprecated": null,
      "control": true,
      "long": "--version",
      "short": "-V",
      "negative": null,
      "polarity": "positive",
      "interaction": false,
      "color": false,
      "schema": null,
      "env": []
    },
    {
      "type": "boolean",
      "name": "manifest",
      "description": "Print this command's manifest as JSON.",
      "deprecated": null,
      "control": true,
      "long": "--manifest",
      "short": null,
      "negative": null,
      "polarity": "positive",
      "interaction": false,
      "color": false,
      "schema": null,
      "env": []
    },
    {
      "type": "string",
      "name": "config",
      "description": "Read configuration from this file alone.",
      "deprecated": null,
      "control": true,
      "long": "--config",
      "short": null,
      "required": false,
      "requiredWhen": null,
      "multiple": false,
      "schema": null,
      "env": [],
      "default": null,
      "implied": null,
      "background": false
    }
  ],
  "command": {
    "name": "convert",
    "path": [
      "convert"
    ],
    "description": "Give a pace per kilometre as a pace per mile, or the other way round.",
    "details": [],
    "examples": [],
    "deprecated": null,
    "hasAction": true,
    "result": {
      "kind": "value",
      "views": [
        "text",
        "json",
        "jsonl"
      ],
      "default": "text",
      "mediaTypes": {
        "text": null,
        "json": "application/json",
        "jsonl": "application/jsonl"
      }
    },
    "failures": [],
    "arguments": [
      {
        "name": "pace",
        "description": "The pace to convert, such as 5:00/km or 8:03/mi.",
        "required": true,
        "variadic": false,
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "pattern": "^(?:\\d+:[0-5]\\d|\\d+):[0-5]\\d ?/(?:km|mi)$",
          "type": "string"
        },
        "default": null
      }
    ],
    "optionGroups": [],
    "options": [
      {
        "type": "string",
        "name": "format",
        "description": "Select the output format, text by default.",
        "deprecated": null,
        "control": true,
        "long": "--format",
        "short": null,
        "required": false,
        "requiredWhen": null,
        "multiple": false,
        "schema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "string",
          "enum": [
            "text",
            "json",
            "jsonl"
          ]
        },
        "env": [],
        "default": null,
        "implied": null,
        "background": false
      }
    ],
    "children": []
  }
}
```

</details>

[Every field is present in every entry](../plugins/manifest.md#manifest-plugin), and an absent value reads `null` or `[]`. At the root the slice is the whole application, so `pace --manifest` prints every Command under `children`.

## Declare the failures a Command raises

`convert`'s entry reads `"failures": []`. Core cannot tell which failures an action raises, so the manifest lists only the failures each Command declares. `splits` can raise `SplitTooLongError`, so it declares that failure through the `manifestCommand` extension from `@loomcli/plugins/manifest/extension`. In `src/commands/splits.ts`, import the extension and the failure class, and give the Command an `extensions` list:

<!-- example: ../../examples/guide/src/07-agents/commands/splits.ts#declaration -->
```ts
export const splits = new Command('splits', {
  description: 'List the time of each split of a run.',
  extensions: [
    manifestCommand({
      failures: [{ failure: SplitTooLongError, meaning: 'The split is longer than the run.' }],
    }),
    mcpCommand({ annotations: { idempotent: true, openWorld: false, readOnly: true } }),
  ],
})
```

- **`failure`** is the class itself. The extension reads the class's [failure code](../core/failures.md#failure-codes) and its [declared exit code](../core/failures.md#declared-exit-codes) when you call it, so the entry holds no code you could mistype.
- **`meaning`** is one line that tells an agent what the failure means before it runs the Command.

The second value, `mcpCommand` from `@loomcli/plugins/mcp/extension`, serves `splits` as an MCP tool, which the next section explains.

Now `pace splits --manifest` lists one entry under `failures`, with the code `split-too-long`, the exit code 64, and that meaning. A Command [inherits no failures](../plugins/manifest.md#manifest-failures) from its parent or the root, so each Command lists the failures it can raise itself. The list is as accurate as your declarations: Loom never checks it against what the action throws.

`manifestCommand` is a [collecting extension](../core/extensions.md#collecting-extensions), so your value and the values a plugin supplies all reach the entry. The same extension takes `details` and `examples` for an instruction an agent needs beyond the help page, as the [manifest extension](../plugins/manifest.md#manifest-extension) describes.

## Serve Commands as MCP tools

The `mcp` Command serves a Command as a tool only when the Command opts in with an `mcpCommand` value from `@loomcli/plugins/mcp/extension`. Add one to `calc` in `src/commands/calc.ts`:

<!-- example: ../../examples/guide/src/07-agents/commands/calc.ts -->
```ts
import { Command } from '@loomcli/core';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { calculatePace } from '../actions/calc.js';
import type { Pace } from '../pace.js';
import { distance, time } from '../validators.js';
import { paceView } from '../views.js';

export const calc = new Command('calc', {
  description: 'Work out the pace of a run.',
  extensions: [mcpCommand({ annotations: { idempotent: true, openWorld: false, readOnly: true } })],
})
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
    validate: distance,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
    validate: time,
  })
  .result<Pace>({ views: { text: paceView } })
  .action(calculatePace);
```

Give `convert` the same value, and add it to the `extensions` list of `splits` beside `manifestCommand`, as the declaration above shows. The `annotations` are hints for the client: `calc` reads nothing outside its inputs and changes nothing, so it is read-only, idempotent, and not open-world. The hints are [yours to set](../plugins/mcp.md#mcp-plugin): Loom infers none from the graph and never verifies them.

`pace mcp` serves three tools, and each one comes from the graph:

- **The name** is the Command's path joined by `_`, so the tools are `calc`, `splits`, and `convert`. The alias `split` is never a tool.
- **The description** is the Command's own description. An `mcpCommand` value can carry a `description` that replaces it for the tool alone.
- **The input schema** is one object, keyed by declared name: the Command's arguments, then its local options, then the global options. Each property is the input's own schema, with its description and its declared default, so `calc`'s tool takes `distance`, `time`, and `unit`, and `unit` lists `km` and `mi` with the default `km`. The `required` list holds `distance` and `time`, the required arguments.
- **Control options are left out.** No tool lists `help`, `version`, `manifest`, `config`, or `format`, because a tool lists what a Command needs, and a control option feeds none of its work. A call that names one fails with a tool error, and no run starts.

A tool call runs the Command through [invocation by name](../core/invocation.md#invocation-by-name), so it is the same run as `pace calc 10k 50:00`, with the same validation, failures, and exit codes. When the Command's result holds a view with the JSON media type, as `calc`'s does once the formatter adds `json`, the plugin selects it and the call returns the parsed JSON too. A failed call reports the failure's own message and its [failure form](../core/failures.md#the-failure-form), so a `splits` call with a split longer than the run returns exit code 64 and the code `split-too-long`. See [MCP plugin](../plugins/mcp.md#mcp-plugin).

To connect a client, configure it to launch `pace mcp` as a server over stdin and stdout. While you develop, the command is `bun src/main.ts mcp`. The server speaks [MCP revision 2026-07-28](../plugins/mcp.md#the-protocol-package), so it works with a client that supports that revision. A client that opens with an `initialize` request, as clients of earlier revisions do, receives an error that names 2026-07-28; use a client that supports that revision instead.

## Write for an agent

A person who reads a vague help page can try a value and read the error. An agent that reads the manifest or the tool listing chooses a Command and fills its inputs from the text you declared, before it runs anything. Your declarations are now most of what an agent knows about `pace`:

- **Descriptions.** The description of the Application, of each Command, and of each input reaches every projection. A description that names the accepted forms, such as `How far you ran, such as 10k, 5mi, 400m, half, or marathon.`, tells an agent what to supply. The manifest and the MCP tool listing [print each of these descriptions on one line](../core/extensions.md).
- **Accepted values.** The schema a validator publishes is the [input schema](../core/validation.md#input-schema) that the manifest and each tool carry. `oneOf` publishes the enum of `--unit`, and the `inputSchema` you gave `createValidator` in chapter 3 publishes the patterns of `distance` and `time`. An input whose validator publishes no schema reads `null` in the manifest, which means unknown, so an agent learns what it accepts only by running the Command and reading the error.

When an agent needs other words than a person, add them for the agent alone: `mcpInput` and `mcpArgument` give an input a tool-only description, and `manifestCommand` takes `details` and `examples`.

## Run a Command from code

A program that embeds `pace`, such as a test or another tool, can run a Command without a shell and read what it wrote. Create `src/scripts/pace-for.ts`, which runs `pace calc` by name:

<!-- example: ../../examples/guide/src/07-agents/scripts/pace-for.ts -->
```ts
import { pace } from '../application.js';

/**
 * Runs `pace calc` by name, as a program that embeds pace does, and returns what the run wrote:
 * the pace, or the failure's message.
 */
export async function paceFor(distance: string, time: string): Promise<string> {
  const outcome = await pace.invoke(['calc'], { args: { distance, time } });
  if (outcome.status === 'cancelled') {
    throw new Error('The run was cancelled.');
  }
  return outcome.status === 'completed' ? outcome.output : outcome.form.message;
}
```

`pace.invoke(['calc'], { args: { distance, time } })` is an [invocation by name](../core/invocation.md#invocation-by-name):

- **The path** names Commands from the root, so `['calc']` routes to `calc`, and `[]` names the root.
- **The values** are keyed by declared name. `args` holds the arguments and `options` holds the options, so `options: { unit: 'mi' }` gives a pace per mile. Each value becomes the token a command line would give, and every validator runs on it.
- **The run** behaves as `pace calc 10k 50:00` does, and it touches no process: it writes nothing to the real stdout or stderr and sets no exit code. `pace.invoke` builds the graph for each call, as `run()` does.

The call resolves an outcome, and its `status` names one of three cases. The function handles each one:

- **`completed`** holds `output`, every byte the run wrote to stdout, so `paceFor('10k', '50:00')` returns `5:00 /km` and a newline. `messages` holds what the run wrote to stderr.
- **`failed`** holds the exit code, the captured text, and the failure's form. `form.message` is the failure's sentence without the application name. A problem names its input by declared name, so `paceFor('10k', '50')` returns `Argument "time": Expected a time above zero as mm:ss or h:mm:ss, such as 25:30.`
- **`cancelled`** holds only the exit code, because a cancelled run's captured text is discarded, so the function has no text to return and throws.

The guide's own test, [`invoke.test.ts`](../../examples/guide/tests/invoke.test.ts), calls `paceFor` with both of those inputs and checks what it returns.

`invoke` takes an options object as its third argument. `{ view: 'json' }` selects the `json` view, so `output` holds JSON that a program parses; the MCP plugin selects that view in the same way. An action reaches the same call as `invoke` on its context, to run another Command of its own graph.

## Next

`pace` now serves people and agents from one set of declarations. In [Shipping](shipping.md), you build it into a command an operator installs, and you keep it correct with the type checker, the linter, and the assembly test.

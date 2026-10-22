---
description: "The author guide: an ordered path that builds one application, pace, from a first action to a shipped command, linking into the reference for every rule."
---

# Author guide

The guide teaches you to build a command-line application with Loom. It builds one application, `pace`, a running-pace calculator, from a first action to a shipped, installable command, one chapter at a time. Read the chapters in order: each one starts from the code the previous one ended with.

The guide teaches and the references state the rules. Each chapter links to the reference page for every rule it uses, so open the link when you need the whole rule.

Every code block in the guide is a file under [`examples/guide/`](../../examples/guide/README.md) that compiles and runs in Loom's own checks, and every block of terminal output is the output of a real run.

## Chapters

1. [Your first application](first-application.md): scaffold an application with `loom init`, declare arguments and an action, and install help and version.
2. [Commands and options](commands-and-options.md): split the application into Commands, declare local and global options, and author each Command in its own module.
3. [Inputs and validation](inputs-and-validation.md): validate inputs before the action runs, declare defaults, and read a value from the environment.
4. [Results and views](results-and-views.md): declare what a Command produces, render it as a table or records, and let the operator choose JSON.
5. [Failures](failures.md): throw failure classes with exit codes, translate errors, and write messages that tell the operator what to do.
6. [Plugins](plugins.md): install and order first-party plugins, read settings from a configuration file, and write a plugin of your own.
7. [Agents](agents.md): describe the application to agents through the manifest and MCP, and call a Command by name from code.
8. [Shipping](shipping.md): build, install, and update the application, and keep it correct with the type checker, the linter, and the assembly test.

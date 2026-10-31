// JavaScript intentionally supplies dynamic names and group tuples that the literal-name types reject.
import { Command } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

function declareHelp(command, spec) {
  if (spec.help !== undefined) {
    command = command.extend(helpCommand(spec.help));
  }
  let declared = command;
  for (const option of spec.options ?? []) {
    declared = declared.option(option.name, optionConfig(option));
  }
  for (const { name, ...config } of spec.arguments ?? []) {
    declared = declared.argument(name, config);
  }
  for (const { kind, options } of spec.groups ?? []) {
    declared = declared[kind](...options);
  }
  if (spec.stdin !== undefined) {
    declared = declared.stdin(spec.stdin);
  }
  for (const child of spec.commands ?? []) {
    const config = { ...child.config };
    declared = declared.command(declareHelp(new Command(child.name, config), child));
  }
  return spec.action === false ? declared : declared.action(() => {});
}

function optionConfig({ configPath, help: shown, name: _name, ...config }) {
  const declared = [
    ...(configPath === undefined ? [] : [configInput({ path: configPath })]),
    ...(shown === undefined ? [] : [helpInput(shown)]),
  ];
  return declared.length === 0 ? config : { ...config, extensions: declared };
}

export { declareHelp };

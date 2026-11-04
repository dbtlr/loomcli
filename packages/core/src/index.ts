export { missingInputError } from './inputs/missing-input.js';
export type { Content } from './inputs/content.js';
export { Application } from './application/application.js';
export { Command, isPortableName } from './commands/command.js';
export { escapeControlCharacters } from './support/controls.js';
export { applicationDirectory } from './shipping/directory.js';
export type { ApplicationDirectory, DirectoryLookup } from './shipping/directory.js';
export {
  questionValidationOptions,
  validationContext,
  validationContextKey,
  validationOptions,
} from './inputs/context.js';
export type { ValidationOptionsContext } from './inputs/context.js';
export { diagnosticRule } from './diagnostics/diagnostic.js';
export { isFailureCode, isRuleIdentity } from './diagnostics/identity.js';
export { isDeclaredName } from './inputs/options.js';
export { isProseLine } from './diagnostics/facts.js';
export { raiseInterruptKeys } from './host/interrupt-keys.js';
export type { InterruptKeys } from './host/interrupt-keys.js';
export type { DiagnosticParts, DiagnosticRule, Finding } from './diagnostics/diagnostic-text.js';
export {
  DeclarationError,
  FatalError,
  InputError,
  InternalError,
  LoomError,
  MisplacedOptionError,
  MissingValueError,
  NonCallableCommandError,
  RepeatedOptionError,
  ResultError,
  UnexpectedArgumentError,
  UnexpectedValueError,
  UnknownCommandError,
  UnknownOptionError,
  UsageError,
  WorkingDirectoryError,
} from './failures/errors.js';
export {
  EX_CANTCREAT,
  EX_CONFIG,
  EX_DATAERR,
  EX_IOERR,
  EX_NOHOST,
  EX_NOINPUT,
  EX_NOPERM,
  EX_NOUSER,
  EX_OSERR,
  EX_OSFILE,
  EX_PROTOCOL,
  EX_SOFTWARE,
  EX_TEMPFAIL,
  EX_UNAVAILABLE,
  EX_USAGE,
} from './failures/exit-codes.js';
export type { FailureExitCode } from './failures/exit-codes.js';
export { extension, readExtension } from './plugins/extension.js';
export { locate } from './inspection/locate.js';
export { incompleteResult, lanes } from './output/lanes.js';
export { override, view } from './output/view.js';
export { plugin } from './plugins/plugin.js';
export { processHandle } from './host/process-handle.js';
export { provider } from './plugins/providers.js';
export type {
  AnyProvider,
  Lifetime,
  Opener,
  ProvidedValues,
  Provider,
  ProviderContext,
  ProviderDefinition,
} from './plugins/providers.js';
export { onResume, onShutdown, onSuspend } from './signals/shutdown.js';
export type {
  OnResume,
  OnShutdown,
  OnSuspend,
  ShutdownEvent,
  Synchronous,
} from './signals/signal-lane.js';
export { translate } from './failures/translators.js';
export { encodeFailure } from './failures/encoders.js';
export { glyph } from './style/glyphs.generated.js';
export type { RenderingPolicy, SwitchPolicy } from './style/rendering.js';
export type { ViewContext } from './output/types.js';
export type { Background } from './host/background.js';
export { nowrap, pad, style } from './style/style.js';
export { splitLines } from './style/lines.js';
export { width } from './style/resolve.js';
export { reportedSpelling } from './inspection/inspect.js';
export { issuePath } from './inputs/validation.js';
export type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
export type { ApplicationMethod, ApplicationOptions } from './application/application.js';
export type { ChainOutcome, MiddlewareContext } from './invocation/chain.js';
export type { InputProblem, InvokedBy, ResultFault } from './failures/errors.js';
export type {
  AnyExtension,
  Extension,
  ExtensionTarget,
  ExtensionValue,
} from './plugins/extension.js';
export type { FailureEncoder, FailureEncoding } from './failures/encoders.js';
export type { FailureForm } from './failures/form.js';
export type { FailureHook, FailureHookContext } from './plugins/hints.js';
export type { EnvironmentContext, EnvironmentHook } from './plugins/prepare-environment.js';
export type {
  JsonValue,
  Log,
  LogDefect,
  LogDestination,
  LogEvent,
  LogFields,
  LogHook,
  LogLevel,
} from './output/log.js';
export type { CommandMethod, CommandOptions } from './commands/command.js';
export type { CancellationReason } from './signals/signals.js';
export type { EndingSignal } from './signals/signal-lane.js';
export type { ErrorClass, Translation, Translator } from './failures/translators.js';
export type { IncompleteResult, Lane } from './output/lanes.js';
export type { WordPosition } from './inspection/locate.js';
export type {
  AnyDeclaredView,
  AnyOverrideKey,
  DeclaredRowView,
  DeclaredView,
  DeclaredViewBrand,
  FailureClass,
  FailureView,
  FailureViewContext,
  ReplacementView,
  ViewContribution,
  ViewOverride,
} from './output/view.js';
export type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  ConfigurationNode,
  InputSchema,
  OptionNode,
  ResultNode,
} from './inspection/inspect.js';
export type {
  Middleware,
  OptionsOf,
  Plugin,
  PluginDefinition,
  PluginOptions,
  PluginOptionSpellings,
  PluginOptionValues,
  SourceAnswer,
  SourceContext,
  SourceResolver,
} from './plugins/plugin.js';
export type { ExitCode, RunOptions } from './application/types.js';
export type {
  Child,
  ChildExit,
  ChildOutput,
  Host,
  HostTerminal,
  InputTerminal,
  OutputTerminal,
  ProcessFields,
  ProcessHandle,
  ProcessSignal,
  ProcessTerminal,
  SignalListener,
  SignalSource,
  SpawnOptions,
} from './host/types.js';
export type {
  ArgumentConfig,
  BooleanOption,
  CountOption,
  ContentArgument,
  ContentOption,
  GlobalOptionConfig,
  StdinConfig,
  InputIdentity,
  OptionConfig,
  ScalarArgument,
  StringOption,
  SuppliedInputs,
  ValidationContext,
  VariadicArgument,
} from './inputs/types.js';
export type {
  Action,
  ActionArgs,
  ActionContext,
  ActionHandler,
  ActionOptions,
  StdinContext,
  InvocationOutcome,
  InvocationValues,
  InvokeOptions,
  Request,
} from './invocation/types.js';
export type {
  Out,
  ProgressEvent,
  ProgressReport,
  Region,
  RegionCloser,
  RegionOptions,
  RenderedData,
  ResultInput,
  ResultView,
  ResultViews,
  RowViewOver,
  RowView,
  RowViews,
  View,
} from './output/types.js';
export type { AttachedCommand, CommandAttachHook, GraphBuiltHook } from './plugins/types.js';
export type { ReleaseFacts } from './shipping/types.js';

export type {
  ApplicationEnvironment,
  EnvironmentOf,
  Register,
  RegisteredEnvironment,
} from './application/environment.js';

export type {
  AdaptiveStyle,
  Ansi16Color,
  Ansi256Fallbacks,
  ColorFallbacks,
  ConcreteStyle,
  ContextualStyle,
  CoreToken,
  Modifier,
  Style,
  ThemeMapping,
  ThemeConstraint,
} from './style/style.js';

export type { OptionGroup } from './inputs/option-groups.js';
export type { Alignment } from './style/wire.js';

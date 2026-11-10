/** Package policies; entry paths always come from the package's exports map. */
export const surfacePackages = [
  {
    directory: 'packages/core',
    entries: {
      '.': {
        externalExports: {
          StandardJSONSchemaV1:
            'The Standard Schema contract follows @standard-schema/spec versions.',
          StandardSchemaV1: 'The Standard Schema contract follows @standard-schema/spec versions.',
        },
        forgottenExports: {
          ActionArgument:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          AfterAction: 'Default type-state parameter of the Command builder.',
          ApplicationBuilder:
            'Builder class behind the exported `Application`; the author names `Application`.',
          ApplicationConstructor: 'Constructor interface; the author writes `typeof Application`.',
          ArgumentExtensions:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          BackgroundOption:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          BooleanFacts:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          CommandBuilder:
            'Builder class behind the exported `Command`; the author names `Command`.',
          CommandConstructor: 'Constructor interface; the author writes `typeof Command`.',
          ConditionalPresence:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          ContentInput:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          ContentReader: 'Members both `Content` variants share; the author names `Content`.',
          Controlled:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          DeclaredTypes:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          Described:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          EnvironmentStyle:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          ExtensionCarrier:
            'Brand class behind the exported `ExtensionValue`; the author names `ExtensionValue`.',
          ExtensionRead:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          FailureEncodingDeclaration:
            'Declaration class behind the exported `FailureEncoding`; the author names `FailureEncoding`.',
          GlobalsOf:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          Listed:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          MetByRegistration:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          MissingValueForm: 'Constructor parameter of a failure class only core constructs.',
          NodeFor:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          Omission:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          OptIn:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          OptionExtensions:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          OptionSpelling:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          OptionValue:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          OverrideDeclaration:
            'Declaration class behind the exported `ViewOverride`; the author names `ViewOverride`.',
          PersistentProvider:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          PluginDeclaration: 'Class behind the exported `Plugin`; the author names `Plugin`.',
          Presence:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          PresenceRuleKey:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          RegistrationShape:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          Reset: 'Reset member names of `style`; the author calls the members by name.',
          ResultMethod:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          RgbArguments:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          RootStyle: 'Type of the exported `style`; the author writes `typeof style`.',
          ShortAlias:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          StringOptionNode:
            'One variant of `OptionNode`; the author narrows `OptionNode` by its kind.',
          TranslationDeclaration:
            'Declaration class behind the exported `Translation`; the author names `Translation`.',
          Unmarked:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          UnmarkedStringOption:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          ValueOf:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          WholeNumbersBelow:
            'Type machinery that computes a signature from type arguments; the author names the computed export.',
          colors: 'Constant behind an exported type union; the author names the union.',
          firstReserved: 'Constant behind an exported type union; the author names the union.',
          modifiers: 'Constant behind an exported type union; the author names the union.',
          reservedCallableNames:
            'Constant behind an exported type union; the author names the union.',
          tokens: 'Constant behind an exported type union; the author names the union.',
        },
      },
    },
    // `node` is the reference to Node's own typings, which a declaration that names a stream needs.
    modules: ['node', 'node:*', '@standard-schema/spec'],
  },
  {
    // The plugins are tagged one group of subpaths at a time; each pass adds its entries here.
    // The declaration-import scan already reads every subpath, so `modules` covers them all.
    coveredEntries: [
      './background',
      './box',
      './color',
      './config',
      './config/extension',
      './dotenv',
      './format',
      './format/views',
      './heading',
      './help',
      './help/extension',
      './help/views',
      './interaction',
      './list',
      './prose',
      './records',
      './rule',
      './suggestions',
      './table',
      './theme',
      './verbose',
      './version',
      './version/views',
    ],
    directory: 'packages/plugins',
    entries: {
      './background': {
        forgottenExports: {
          options:
            'Constant behind the exported `BackgroundOptions`; the author names `BackgroundOptions`.',
        },
      },
      './color': {
        forgottenExports: {
          options: 'Constant behind the exported `ColorOptions`; the author names `ColorOptions`.',
        },
      },
      './config': {
        forgottenExports: {
          EveryKeyOptional:
            'Type machinery behind the exported `EmptyFileGuard`; the author names `EmptyFileGuard`.',
          Short:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
          options:
            'Constant behind the exported `ConfigOptions`; the author names `ConfigOptions`.',
        },
      },
      './help': {
        forgottenExports: {
          options: 'Constant behind the exported `HelpOptions`; the author names `HelpOptions`.',
        },
      },
      './interaction': {
        forgottenExports: {
          options:
            'Constant behind the exported `InteractionOptions`; the author names `InteractionOptions`.',
        },
      },
      './theme': {
        forgottenExports: {
          defaults:
            'Constant behind the exported `LoomThemeDefaults`; the author names `LoomThemeDefaults`.',
        },
      },
      './verbose': {
        forgottenExports: {
          options:
            'Constant behind the exported `VerboseOptions`; the author names `VerboseOptions`.',
        },
      },
      './version': {
        forgottenExports: {
          options:
            'Constant behind the exported `VersionOptions`; the author names `VersionOptions`.',
        },
      },
    },
    modules: ['node:*', '@loomcli/core', '@loomcli/validators', '@standard-schema/spec'],
  },
];

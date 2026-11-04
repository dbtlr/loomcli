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
          EnvBinding:
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
          ListBinding:
            'Fragment of an exported option or argument configuration; the author names the whole configuration.',
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
            'Type machinery that computes `EmptyFileGuard` from a schema; the author names `EmptyFileGuard`.',
          Short:
            "Alias of core's `StringOption['short']`; the author writes the one-letter spelling.",
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
      './logging': {
        forgottenExports: {
          LoggingErrorDetail:
            'Constructor parameter of a failure class only the plugin constructs.',
        },
      },
      './manifest': {
        forgottenExports: {
          options:
            'Constant behind the exported `ManifestOptions`; the author names `ManifestOptions`.',
        },
      },
      './records': {
        forgottenExports: {
          FieldDefinition:
            "One key's member of the exported `FieldEntry`; the author names `FieldEntry`.",
        },
      },
      './table': {
        forgottenExports: {
          ColumnDefinition:
            "One key's member of the exported `ColumnEntry`; the author names `ColumnEntry`.",
        },
      },
      './theme': {
        forgottenExports: {
          LoomThemeDefaults:
            "Type of the palette's private defaults; the author reads its tokens through the plugin `loomTheme` returns.",
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
    modules: ['node:*', '@loomcli/core', '@loomcli/validators'],
  },
  {
    directory: 'packages/validators',
    entries: {
      '.': {
        forgottenExports: {
          AcceptedOutput:
            "Type machinery that computes `createValidator`'s output from what `parse` returns; the author names the output type.",
        },
      },
    },
    modules: ['@loomcli/core'],
  },
  {
    directory: 'packages/prompts',
    entries: {
      '.': {
        forgottenExports: {
          ChoiceDetails:
            'Members both `ChoiceObject` variants share; the author names `ChoiceObject`.',
          ChoiceList:
            'Fragment of the exported select and multiselect settings; the author names the whole settings.',
          Link: 'Fragment of each exported question settings type; the author names the whole settings.',
          LinkedChoices:
            'Fragment of the exported select and multiselect settings; the author names the whole settings.',
          StringValue:
            'Type machinery that computes the string a choice may stand for; the author names `Choice`.',
        },
      },
    },
    modules: ['@loomcli/core'],
  },
  {
    directory: 'packages/testing',
    entries: {
      '.': {
        forgottenExports: {
          MiddlewareInputs:
            'Key list behind the exported `MiddlewareValues`; the author names `MiddlewareValues`.',
          MockFacts: 'Members every `MockFields` variant shares; the author names `MockFields`.',
          OptionalMembers:
            'Type machinery that makes the context members a builder does not require optional; the author names each builder input.',
        },
      },
    },
    modules: ['node:*', '@loomcli/core'],
  },
  {
    directory: 'packages/eslint-plugin',
    entries: {},
    // ESLint's and ESTree's types are what a lint plugin's rules plug into.
    modules: ['eslint', 'estree'],
  },
];

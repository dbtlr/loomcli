//! Commands, their authoring states, and the declarations a Command carries.
//!
//! A `Command<I, R, S>` is an immutable builder value: each call consumes it and returns the next.
//! `I` is the inputs struct its action reads, `R` the result it declares, and `S` the authoring
//! state, which removes the calls a call invalidates, as the reference's types do: arguments and
//! children exclude each other, and `action()` closes every authoring call but `extend()` and
//! `views()`.

pub(crate) mod declaration;
mod messages;
mod option_sets;
mod state;

use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use serde::Serialize;

use crate::inputs::{ArgumentDecl, Inputs, NoInputs, OptionDecl, Stdin};
use crate::invocation::{Context, Outcome};
use crate::output::{NoResult, ResultViews, RowViews, RowsResult, ValueResult};
use crate::plugins::{AnyProvider, CommandTarget, ExtensionValue};
use crate::support::IntoList;

pub use option_sets::OptionSet;

pub use state::{
    CarriesResult, Configuring, Done, Fresh, Group, NoResultYet, Open, State, TakesGlobals,
};

/// A named Command.
///
/// `Command::new(name)` declares it; the remaining calls follow the authoring order the state `S`
/// enforces. A fault the types cannot express panics at the call with its Developer Diagnostic, at
/// the caller's line, as the reference's declaration fault throws while the module evaluates.
///
/// ```
/// use loomcli_core::{Application, Arg, Command, Context, GroupCommand, Opt};
///
/// fn cache() -> GroupCommand {
///     Command::new("cache").command(
///         Command::new("clear")
///             .alias("rm")
///             .argument("key", Arg::string())
///             .option("all", Opt::boolean())
///             .action(|ctx: Context| async move {
///                 let key: Option<String> = ctx.argument("key")?;
///                 ctx.out.print(&key.unwrap_or_default()).await
///             }),
///     )
/// }
///
/// let graph = Application::new("app").command(cache()).inspect().unwrap();
/// assert!(graph.command(&["cache", "clear"]).is_some());
/// ```
#[must_use]
pub struct Command<I = NoInputs, R = NoResult, S = Done> {
    pub(crate) declaration: declaration::CommandDeclaration,
    pub(crate) _types: crate::__private::Types<I, R, S>,
}

impl Command<NoInputs, NoResult, Fresh> {
    /// Declares a Command. The name is a portable name; another is a fault at this call.
    #[track_caller]
    pub fn new(name: &str) -> Self {
        Command {
            declaration: declaration::raise(declaration::CommandDeclaration::named(name)),
            _types: PhantomData,
        }
    }
}

// Each state bound sits in the method's where clause, not the impl header, so a call the state
// removes reports the bound's `on_unimplemented` message (E0277) rather than a bare E0599.
impl<I, R, S: State> Command<I, R, S> {
    /// Sets the description every projection reads.
    pub fn description(self, text: impl Into<String>) -> Self
    where
        S: Open,
    {
        let mut command = self;
        command.declaration.description = Some(text.into());
        command
    }

    /// Keeps the Command off every listing; it still routes and runs.
    pub fn hidden(self) -> Self
    where
        S: Open,
    {
        let mut command = self;
        command.declaration.hidden = true;
        command
    }

    /// Marks the Command deprecated, with the migration message a projection prints beside it.
    pub fn deprecated(self, message: impl Into<String>) -> Self
    where
        S: Open,
    {
        let mut command = self;
        command.declaration.deprecated = Some(message.into());
        command
    }

    /// Lists the providers whose values the action reads. Two different providers with one name
    /// among the providers the list reaches are a fault at this call.
    #[track_caller]
    pub fn uses(self, providers: impl IntoList<AnyProvider>) -> Self
    where
        S: Open,
    {
        let mut command = self;
        let providers = providers.into_list();
        declaration::raise(crate::plugins::check_uses(
            command.declaration.name.as_deref(),
            &command.declaration.uses,
            &providers,
        ));
        command.declaration.uses.extend(providers);
        command
    }

    /// Declares an unadvertised synonym that routes to this Command. Call it once per alias; an
    /// alias that repeats the Command's own name or one of its aliases adds nothing.
    #[track_caller]
    pub fn alias(self, name: &str) -> Self
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_alias(name));
        command
    }

    /// Declares a local option.
    #[track_caller]
    pub fn option(
        self,
        name: &str,
        option: impl Into<OptionDecl>,
    ) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_option(
            name,
            option.into(),
            &declaration::GlobalTable::default(),
        ));
        command.retyped()
    }

    /// Applies a reusable set of local options and groups.
    #[track_caller]
    pub fn options(self, set: &OptionSet) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(set.apply(
            &mut command.declaration,
            &declaration::GlobalTable::default(),
        ));
        command.retyped()
    }

    /// Declares standalone stdin, which the action reads under `ctx.stdin`. A Command whose content
    /// input already claims stdin faults here under `stdin-claimed-twice`.
    #[track_caller]
    pub fn stdin(self, stdin: Stdin) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_stdin(stdin));
        command.retyped()
    }

    /// Enables passthrough after the first bare `--`. A second declaration is a call fault.
    #[track_caller]
    pub fn passthrough(self, mode: Passthrough) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_passthrough(mode));
        command.retyped()
    }

    /// Requires stdin and stderr at a terminal outside CI. A second declaration is a call fault.
    #[track_caller]
    pub fn needs_terminal(self) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_terminal_need());
        command.retyped()
    }

    /// Requires each named local option when `option` is supplied.
    #[track_caller]
    pub fn requires(self, option: &str, needed: &[&str]) -> Self
    where
        S: Open,
    {
        let mut command = self;
        let names = crate::inputs::groups::requirement_members(option, needed);
        declaration::raise(
            command
                .declaration
                .declare_group(crate::inspection::OptionGroupKind::Requires, &names),
        );
        command
    }

    /// Declares that at most one of these local options is supplied.
    #[track_caller]
    pub fn exclusive(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(
            command
                .declaration
                .declare_group(crate::inspection::OptionGroupKind::Exclusive, names),
        );
        command
    }

    /// Declares that at least one of these local options is supplied.
    #[track_caller]
    pub fn one_required(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(
            command
                .declaration
                .declare_group(crate::inspection::OptionGroupKind::OneRequired, names),
        );
        command
    }

    /// Declares that these local options are supplied together or not at all.
    #[track_caller]
    pub fn required_together(self, names: &[&str]) -> Self
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(
            command
                .declaration
                .declare_group(crate::inspection::OptionGroupKind::RequiredTogether, names),
        );
        command
    }

    /// Declares an argument. Arguments bind words in declaration order.
    #[track_caller]
    pub fn argument(
        self,
        name: &str,
        argument: impl Into<ArgumentDecl>,
    ) -> Command<I, R, <S as State>::Declared>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.declare_argument(name, argument.into()));
        command.retyped()
    }

    /// Attaches a child Command, finished or not; attach judges it as a finished Command.
    #[track_caller]
    pub fn command(self, child: impl Into<AnyCommand>) -> Command<I, R, Group>
    where
        S: Open,
    {
        let mut command = self;
        declaration::raise(command.declaration.attach(child.into().declaration));
        command.retyped()
    }

    /// Attaches extension values, in every state. A value its descriptor's rules reject is a fault
    /// at this call, under `invalid-extension-value`.
    #[track_caller]
    pub fn extend(self, values: impl IntoList<ExtensionValue<CommandTarget>>) -> Self {
        let mut command = self;
        declaration::raise(command.declaration.extend(&values.into_list()));
        command
    }
}

impl<R, S: State> Command<NoInputs, R, S> {
    /// Declares the fields of `J` as arguments and options, and types the action's inputs as `J`.
    #[track_caller]
    pub fn inputs<J>(self) -> Command<J, R, <S as State>::Declared>
    where
        S: Open,
        J: Inputs,
    {
        let mut command = self;
        let calls = J::declare(crate::inputs::Declarations::new()).calls;
        declaration::raise(
            command
                .declaration
                .declare_all(calls, &declaration::GlobalTable::default()),
        );
        command.retyped()
    }
}

impl<I, R, S: State> Command<I, R, S> {
    /// Declares a result of one value, with its named whole views.
    #[track_caller]
    pub fn result<V: Serialize + Send + Sync + 'static>(
        self,
        views: ResultViews<V>,
    ) -> Command<I, ValueResult<V>, <S as State>::Declared>
    where
        S: Open,
        R: NoResultYet,
    {
        let mut command = self;
        command
            .declaration
            .results
            .push(views.call(declaration::ResultCallKind::Value));
        command.retyped()
    }

    /// Declares a result of rows, with its named views.
    #[track_caller]
    pub fn rows<Row: Serialize + Send + Sync + 'static>(
        self,
        views: RowViews<Row>,
    ) -> Command<I, RowsResult<Row>, <S as State>::Declared>
    where
        S: Open,
        R: NoResultYet,
    {
        let mut command = self;
        command
            .declaration
            .results
            .push(views.call(declaration::ResultCallKind::Rows));
        command.retyped()
    }
}

impl<I, R, S: State> Command<I, R, S> {
    /// Adds or replaces result views by name, in every state.
    #[track_caller]
    pub fn views(self, replacements: <R as CarriesResult>::Views) -> Self
    where
        R: CarriesResult,
    {
        let mut command = self;
        command
            .declaration
            .results
            .push(R::views_call(replacements).0);
        command
    }
}

impl<I: Inputs, R: crate::output::ResultKind, S: State> Command<I, R, S> {
    /// Registers the action. Registering runs nothing; core calls it when routing selects this
    /// Command and the invocation reaches the dispatch boundary.
    ///
    /// A handler that captures state clones it into the future it returns:
    /// `move |ctx| { let shared = shared.clone(); async move { … } }`. Stable Rust gives an
    /// `async move |ctx|` closure that captures state no `Fn` impl with a `Send` future.
    pub fn action<H, Fut>(self, handler: H) -> Command<I, R, Done>
    where
        S: Open,
        H: Fn(Context<I, R>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Outcome> + Send + 'static,
    {
        let mut command = self;
        command.declaration.action = Some(erase_action::<I, R, H, Fut>(handler));
        command.retyped()
    }
}

impl<I, R, S> Command<I, R, S> {
    /// The same declaration in another authoring state or with other types.
    fn retyped<J, Q, T>(self) -> Command<J, Q, T> {
        Command {
            declaration: self.declaration,
            _types: PhantomData,
        }
    }
}

/// Erases a typed handler: the stored action extracts `I` from the validated values, retypes the
/// context, and calls the handler. An extraction that fails is the action's failure.
pub(crate) fn erase_action<I, R, H, Fut>(handler: H) -> declaration::ErasedAction
where
    I: Inputs,
    R: crate::output::ResultKind,
    H: Fn(Context<I, R>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Outcome> + Send + 'static,
{
    Arc::new(
        move |call: crate::__private::ActionCall| match I::extract(&call.values) {
            Ok(inputs) => Box::pin(handler(call.context.retyped(inputs))),
            Err(error) => Box::pin(async move { Err(error) }),
        },
    )
}

/// A group Command with no action of its own, as a function that builds one names its return type.
pub type GroupCommand<I = NoInputs, R = NoResult> = Command<I, R, Group>;

/// A Command in any state with its types erased, as `command()` and a plugin's `commands` list take it.
pub struct AnyCommand {
    pub(crate) declaration: declaration::CommandDeclaration,
}

impl<I, R, S: State> From<Command<I, R, S>> for AnyCommand {
    fn from(command: Command<I, R, S>) -> Self {
        AnyCommand {
            declaration: command.declaration,
        }
    }
}

/// An opt-in passthrough declaration for the words after the first bare `--`.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct Passthrough {
    pub(crate) description: Option<String>,
}

impl Passthrough {
    /// Declares the mode without a description.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the description the Command's projections read.
    pub fn description(mut self, text: impl Into<String>) -> Self {
        self.description = Some(text.into());
        self
    }

    pub(crate) fn literal(&self) -> crate::diagnostics::Literal {
        let literal = crate::diagnostics::Literal::builder("Passthrough::new()");
        match &self.description {
            Some(description) => literal.call("description", vec![description.as_str().into()]),
            None => literal,
        }
    }
}

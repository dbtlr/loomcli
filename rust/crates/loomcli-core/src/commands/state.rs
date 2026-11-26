//! Authoring states. Each call returns a value whose state offers the calls still valid.
//!
//! | State | Reached by | Offers |
//! | --- | --- | --- |
//! | `Configuring` | `Application::new` | `plugins()`, and every call `Fresh` offers |
//! | `Fresh` | `Command::new`, or any call on `Configuring` | arguments, children, options, globals |
//! | `Group` | `command()` | arguments, children, options |
//! | `Done` | `action()` | `extend()`, and `views()` on a declaration with a result |

use crate::output::{ResultViews, RowViews, RowsResult, ValueResult};

mod sealed {
    pub trait Sealed {}
}

/// An authoring state.
pub trait State: sealed::Sealed + Send + Sync + 'static {
    /// The state after a call that removes nothing: `Configuring` becomes `Fresh`, every other
    /// state stays. Every state names one, `Done` included, so a call's return type resolves before
    /// its [`Open`] bound is judged and a call after `action()` reports that bound's message.
    type Declared: State;
}

/// A state that still takes authoring calls: every state but `Done`.
///
/// Every authoring call but `extend()` and `views()` bounds its state by `Open`, so a call after
/// `action()` reports this trait's message (E0277):
///
/// ```compile_fail,E0277
/// use loomcli_core::{Command, Context, Opt};
///
/// let _ = Command::new("deploy")
///     .action(|_: Context| async { Ok(()) })
///     .option("force", Opt::boolean());
/// ```
#[diagnostic::on_unimplemented(
    message = "this declaration registered its action, so it takes no further authoring call",
    label = "only `extend()`, and `views()` on a declaration with a result, follow `action()`"
)]
pub trait Open: State {}

/// A state that takes global options and plugins: before the Application's first `command()` or
/// `action()`.
#[diagnostic::on_unimplemented(
    message = "declare global options before the first `command()` or `action()`",
    label = "this Application already attached a child or registered its action"
)]
pub trait TakesGlobals: Open {}

/// The Application's first state: `plugins()` is still available.
pub struct Configuring;
/// A fresh declaration.
pub struct Fresh;
/// A declaration with children.
pub struct Group;
/// A declaration whose action is registered.
pub struct Done;

impl sealed::Sealed for Configuring {}
impl sealed::Sealed for Fresh {}
impl sealed::Sealed for Group {}
impl sealed::Sealed for Done {}

impl State for Configuring {
    type Declared = Fresh;
}
impl State for Fresh {
    type Declared = Fresh;
}
impl State for Group {
    type Declared = Group;
}
impl State for Done {
    type Declared = Done;
}

impl Open for Configuring {}
impl Open for Fresh {}
impl Open for Group {}

impl TakesGlobals for Configuring {}
impl TakesGlobals for Fresh {}

/// A declaration that declares no result yet, so `result()` and `rows()` are available.
///
/// A second result call reports this trait's message (E0277):
///
/// ```compile_fail,E0277
/// use loomcli_core::{Command, ResultViews, RowViews};
///
/// let _ = Command::new("list")
///     .result(ResultViews::<String>::new())
///     .rows(RowViews::<String>::new());
/// ```
#[diagnostic::on_unimplemented(
    message = "this declaration already declares a result, and a declaration declares one result",
    label = "`result()` or `rows()` was already called; `views()` adds views to that result"
)]
pub trait NoResultYet {}

impl NoResultYet for crate::output::NoResult {}

/// A result kind that carries views, so `views()` exists on its declarations.
///
/// `views()` on a declaration with no result reports this trait's message (E0277):
///
/// ```compile_fail,E0277
/// use loomcli_core::{Command, ResultViews};
///
/// let _ = Command::new("list").views(ResultViews::<String>::new());
/// ```
#[diagnostic::on_unimplemented(
    message = "`views()` replaces a declared result's views, and this declaration declares no result"
)]
pub trait CarriesResult {
    /// The replacement record `views()` takes.
    type Views;
    #[doc(hidden)]
    fn views_call(views: Self::Views) -> crate::__private::ViewsCall;
}

impl<V: serde::Serialize + 'static> CarriesResult for ValueResult<V> {
    type Views = ResultViews<V>;
    fn views_call(views: ResultViews<V>) -> crate::__private::ViewsCall {
        crate::__private::ViewsCall(views.call(super::declaration::ResultCallKind::Views))
    }
}

impl<R: serde::Serialize + 'static> CarriesResult for RowsResult<R> {
    type Views = RowViews<R>;
    fn views_call(views: RowViews<R>) -> crate::__private::ViewsCall {
        crate::__private::ViewsCall(views.call(super::declaration::ResultCallKind::Views))
    }
}

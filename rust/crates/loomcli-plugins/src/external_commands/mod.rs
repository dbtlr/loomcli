//! Runs a program from PATH for the first unknown word of an argv invocation.

mod messages;
mod search;
mod system_error;

use loomcli_core::{
    Activation, ChildExit, ChildStream, ExitCode, InvokedBy, MiddlewareContext, Next, NoOptions,
    Outcome, Plugin, SpawnOptions, is_portable_name,
};

use crate::PACKAGE_NAME;

/// Lets an operator extend an application with an executable named `<application>-<word>` on
/// PATH. A declared Command takes precedence. External commands run only for the first word of
/// an argv invocation. The child receives the words after it and supplies the run's exit code.
pub fn external_commands() -> Plugin<NoOptions> {
    Plugin::new(format!("{PACKAGE_NAME}/external-commands"))
        .middleware(Activation::Always, middleware)
}

async fn middleware(ctx: MiddlewareContext<NoOptions>, next: Next) -> Outcome {
    let Some((program, rest)) = program_for(&ctx) else {
        return next.run().await.map(|_| ());
    };
    let (template, fields) = messages::running(&program);
    ctx.log.debug(template, fields);
    let ended = ctx
        .out
        .lend_terminal(|| async {
            let options = SpawnOptions::new()
                .inherit_stdin()
                .stdout(ChildStream::Inherit)
                .stderr(ChildStream::Inherit)
                .signal(ctx.signal.token());
            let ended = ctx
                .host
                .spawn(&program, rest, options.clone())
                .exited()
                .await;
            let ChildExit::Unstarted { error } = &ended else {
                return ended;
            };
            if ctx.host.platform != "linux"
                || system_error::start_code(error).as_deref() != Some("ENOEXEC")
            {
                return ended;
            }

            let args = std::iter::once(&program).chain(rest);
            match ctx.host.spawn("/bin/sh", args, options).exited().await {
                ChildExit::Unstarted { .. } => ended,
                shell => shell,
            }
        })
        .await;
    let code = match ended {
        ChildExit::Exited { code, .. } => u8::try_from(code).unwrap_or(1),
        ChildExit::Unstarted { error } => {
            let code = system_error::start_code(&error);
            return Err(ctx.out.fatal(messages::cannot_run(
                &ctx.graph.name,
                &program,
                code.as_deref(),
            )));
        }
        _ => 1,
    };
    ctx.set_exit_code(ExitCode::new(code));
    Ok(())
}

fn program_for(ctx: &MiddlewareContext<NoOptions>) -> Option<(String, &[String])> {
    let unknown = ctx.unknown_command.as_deref()?;
    let (first, rest) = ctx.host.argv.split_first()?;
    // The same spelling can appear first and again as an unknown word beneath a group.
    if ctx.invoked_by != InvokedBy::Argv
        || first != &unknown.word
        || rest.len() != unknown.rest.len()
        || !is_portable_name(&unknown.word)
    {
        return None;
    }
    let name = format!("{}-{}", ctx.graph.name, unknown.word);
    let program = search::find_program(&name, &ctx.host, &ctx.log)?;
    Some((program, &unknown.rest))
}

//! The middleware: explains the routed Command and takes the invocation over.

use loomcli_core::{
    CommandGraph, CommandNode, Error, MiddlewareContext, Next, Outcome, read_extension,
};

use crate::ExplainOptions;
use crate::extension::EXPLAIN_COMMAND;

/// The lines one explanation prints: the routed path, or the application's own name for the root,
/// then the description, then the details and examples the declaration carries. A stored value the
/// descriptor cannot read is the read's own declaration fault.
fn lines(command: &CommandNode, graph: &CommandGraph) -> Result<Vec<String>, Error> {
    // The root Command carries no description of its own: the Application's is the graph's fact.
    let routed = !command.path.is_empty();
    let description = if routed {
        command.description.clone()
    } else {
        graph.description.clone()
    };
    let mut lines = vec![if routed {
        format!("{} {}", graph.name, command.path.join(" "))
    } else {
        graph.name.clone()
    }];
    lines.extend(description);
    if let Some(explanation) = read_extension(command, &EXPLAIN_COMMAND)? {
        lines.push(explanation.details);
        lines.extend(
            explanation
                .examples
                .unwrap_or_default()
                .into_iter()
                .map(|example| format!("  {example}")),
        );
    }
    Ok(lines)
}

/// Explains the routed Command and returns without running `next`, which takes the invocation
/// over: the remaining words are never validated and no document is ever read.
pub(crate) async fn explain_command(
    context: MiddlewareContext<ExplainOptions>,
    _next: Next,
) -> Outcome {
    for line in lines(&context.command, &context.graph)? {
        context.out.print(&line).await?;
    }
    Ok(())
}

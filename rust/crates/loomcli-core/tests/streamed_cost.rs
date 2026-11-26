//! The retained work and source lifetime of a streamed message.

mod support;

use loomcli_core::{
    Application, Context, RenderingPolicy, RunOptions, Switch, View, lanes, override_view, style,
};
use loomcli_testing::{MockFields, mock_process};
use std::sync::{Arc, Mutex};
use support::streaming::{Destination, Lane, bytes, chunks};

#[tokio::test]
async fn a_lane_override_gets_the_entire_text_so_far_at_each_chunk() {
    let layouts = Arc::new(Mutex::new(Vec::new()));
    let calls = layouts.clone();
    let app = Application::new("streamed")
        .overrides([override_view(
            lanes::info(),
            View::new(move |text: &str, _| {
                calls
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(text.to_owned());
                format!("[{text}]")
            }),
        )])
        .action(
            |ctx: Context| async move { ctx.out.info(chunks(["one\n", "two\n", "three"])).await },
        );
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stderr_text(), "[one\ntwo\nthree]\n");
    assert_eq!(
        layouts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_slice(),
        &["one\n", "one\ntwo\n", "one\ntwo\nthree", "one\ntwo\nthree"]
    );
}

#[tokio::test]
async fn raw_and_nested_styles_left_open_match_the_whole_text() {
    let destination = Destination {
        columns: None,
        term: "xterm-256color",
        policy: RenderingPolicy::new()
            .color(Switch::Always)
            .modifiers(Switch::Always),
    };
    for text in [
        style().red().apply("x one\ny two\nq\nw four"),
        style().red().apply(&format!(
            "x one\n{}\nw four\nv",
            style().bold().apply("y two\nz three\nq")
        )),
        "a\x1b[31mred\nstill\nmore\nlast".to_owned(),
    ] {
        let streamed = destination
            .writes(
                Lane::Info,
                text.split_inclusive('\n').map(str::to_owned).collect(),
                true,
                false,
            )
            .await;
        let whole = destination
            .writes(Lane::Info, vec![text], false, false)
            .await;
        assert_eq!(bytes(&streamed), bytes(&whole));
    }
}

#[tokio::test]
async fn a_long_unbroken_line_and_a_long_run_inside_it_are_written_in_full() {
    for columns in [None, Some(100)] {
        let destination = Destination {
            columns,
            term: "xterm",
            policy: RenderingPolicy::new(),
        };
        for lane in [Lane::Print, Lane::Info] {
            let destination = Destination {
                columns: None,
                ..destination
            };
            let text = "x".repeat(16_000);
            for chunk_size in [80, 160] {
                let parts = (0..16_000 / chunk_size)
                    .map(|_| "x".repeat(chunk_size))
                    .collect();
                let writes = destination.writes(lane, parts, true, false).await;
                let whole = destination
                    .writes(lane, vec![text.clone()], false, false)
                    .await;
                assert_eq!(bytes(&writes), bytes(&whole));
            }
        }
        for character in ['x', ' '] {
            let parts = vec![
                "start ".to_owned(),
                character.to_string().repeat(16_000),
                "a".to_owned(),
                "b".to_owned(),
                "c".to_owned(),
                "d".to_owned(),
                "e\n".to_owned(),
            ];
            let writes = destination
                .writes(Lane::Print, parts.clone(), true, false)
                .await;
            assert_eq!(bytes(&writes), parts.concat());
        }
    }
}

#[tokio::test]
async fn successive_messages_each_release_their_sources() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::task::Poll;
    use support::streaming::PollStream;
    struct Tally(Arc<AtomicUsize>);
    impl Drop for Tally {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    let ended = Arc::new(AtomicUsize::new(0));
    let expected = ended.clone();
    let app = Application::new("streamed").action(move |ctx: Context| {
        let ended = expected.clone();
        async move {
            for index in 0..60 {
                let tally = Tally(ended.clone());
                let mut first = Some("line\n");
                let source = PollStream(move |_: &mut std::task::Context<'_>| {
                    let _keep = &tally;
                    Poll::Ready(first.take().map(|part| Ok(part.to_owned())))
                });
                ctx.out
                    .print(loomcli_core::StreamedMessage::new(source))
                    .await?;
                assert_eq!(ended.load(Ordering::SeqCst), index + 1);
            }
            Ok(())
        }
    });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(mock.stdout_text(), "line\n".repeat(60));
}

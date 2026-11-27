//! The shared frame and lifetime of a root progress line and its tasks.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use loomcli_core::{
    BoxFuture, EndState, Error, Host, Message, Out, ProgressReport, Region, RegionCloser,
    RegionOptions, View,
};
use tokio::runtime::Handle;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::estimate::Estimate;
use crate::height::Layout;
use crate::progress::{
    ProgressSettings, ProgressStyleSettings, ProgressUpdate, Spinner, default_bar, default_spinner,
    drive, locked,
};
use crate::progress_log::{ProgressLog, kept_view};
use crate::views::{BarCells, ProgressLine, ProgressState, progress_line};

const ROOT: usize = 0;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum End {
    Success,
    Failure,
    Skip,
    Warn,
    Clear,
    Cancel,
}

impl End {
    fn state(self) -> ProgressState {
        match self {
            Self::Success | Self::Clear => ProgressState::Ended,
            Self::Failure => ProgressState::Failed,
            Self::Skip => ProgressState::Skipped,
            Self::Warn => ProgressState::Warned,
            Self::Cancel => ProgressState::Cancelled,
        }
    }

    fn region(self) -> EndState {
        match self {
            Self::Failure => EndState::Failed,
            Self::Warn => EndState::Warned,
            Self::Skip => EndState::Skipped,
            _ => EndState::Ended,
        }
    }

    fn keeps_log(self) -> bool {
        matches!(self, Self::Failure | Self::Warn | Self::Cancel)
    }

    fn keeps_tasks(self, keep_tasks: bool) -> bool {
        self.keeps_log() || (self != Self::Clear && keep_tasks)
    }
}

struct Node {
    parent: usize,
    depth: usize,
    children: Vec<usize>,
    region: Region,
    label: String,
    total: Option<f64>,
    completed: Option<f64>,
    started: Instant,
    ended: Option<(End, u64, usize)>,
    kept: Option<String>,
    spinner: Spinner,
    tick: usize,
    estimate: Estimate,
    show_estimate: bool,
    unit: Option<String>,
    log: Arc<ProgressLog>,
    keep_tasks: bool,
}

impl Node {
    fn new(
        parent: usize,
        depth: usize,
        region: Region,
        style: &ProgressStyleSettings,
        settings: ProgressSettings,
        started: Instant,
    ) -> Self {
        Self {
            parent,
            depth,
            children: Vec::new(),
            region,
            label: settings.label,
            total: settings.total,
            completed: settings.total.map(|_| 0.0),
            started,
            ended: None,
            kept: None,
            spinner: settings
                .spinner
                .or_else(|| style.spinner.clone())
                .unwrap_or_else(default_spinner),
            tick: 0,
            estimate: Estimate::default(),
            show_estimate: settings.estimate,
            unit: settings.unit,
            log: ProgressLog::new(settings.log_rows, settings.log_limit),
            keep_tasks: settings.keep_tasks,
        }
    }

    fn elapsed(&self, now: Instant) -> u64 {
        u64::try_from(now.saturating_duration_since(self.started).as_millis()).unwrap_or(u64::MAX)
    }

    fn data(&self, now: Instant, bar: &BarCells) -> ProgressLine {
        let (state, elapsed) = self.ended.map_or_else(
            || (ProgressState::Running, self.elapsed(now)),
            |(end, elapsed, _)| (end.state(), elapsed),
        );
        let frame = if self.spinner.frames.is_empty() {
            String::new()
        } else {
            self.spinner.frames[self.tick % self.spinner.frames.len()].clone()
        };
        let (rate, remaining) = self.estimate.figures(self.total, elapsed);
        ProgressLine::new(state, &self.label)
            .counts(self.completed, self.total)
            .frame(frame)
            .bar(bar.clone())
            .elapsed(elapsed)
            .estimate(self.show_estimate, rate, remaining, self.unit.clone())
            .depth(self.depth)
    }

    fn report(&self) -> ProgressReport {
        let mut report = ProgressReport::new().label(&self.label);
        if let Some(total) = self.total {
            report = report.completed(0.0).total(total);
        }
        report
    }
}

struct State {
    nodes: BTreeMap<usize, Node>,
    // Running IDs and finished IDs refer to nodes. Branch removal runs after their running
    // descendants end, and removes the finished entries along with the nodes.
    running: BTreeSet<usize>,
    /// Sequence number and node id, so a frame needs only the finished rows it can draw.
    finished: BTreeMap<usize, usize>,
    next_line: usize,
    next_finish: usize,
}

impl State {
    /// Running nodes in tree order, taking only the open edges.
    fn running_order(&self) -> Vec<usize> {
        let mut children: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for &line in self.running.iter().filter(|&&line| line != ROOT) {
            children
                .entry(self.nodes[&line].parent)
                .or_default()
                .push(line);
        }
        let mut order = Vec::with_capacity(self.running.len());
        let mut todo = vec![ROOT];
        while let Some(line) = todo.pop() {
            order.push(line);
            if let Some(children) = children.get(&line) {
                todo.extend(children.iter().rev().copied());
            }
        }
        order
    }

    fn postorder_open(&self, root: usize) -> Vec<usize> {
        let mut todo = vec![(root, false)];
        let mut order = Vec::new();
        while let Some((id, visited)) = todo.pop() {
            if !self.running.contains(&id) {
                continue;
            }
            if visited {
                order.push(id);
            } else {
                todo.push((id, true));
                todo.extend(
                    self.nodes[&id]
                        .children
                        .iter()
                        .rev()
                        .map(|&task| (task, false)),
                );
            }
        }
        order
    }

    fn remove_branches(&mut self, mut children: Vec<usize>) {
        while let Some(id) = children.pop() {
            if let Some(node) = self.nodes.remove(&id) {
                if let Some((_, _, order)) = node.ended {
                    self.finished.remove(&order);
                }
                children.extend(node.children);
            }
        }
    }
}

struct EndLine {
    end: End,
    data: ProgressLine,
    kept: Option<String>,
}

enum Presentation {
    Plain(Vec<EndLine>),
    Last(Box<EndLine>),
    Tree(Vec<EndLine>),
    Clear,
    Redraw,
}

struct Closing {
    region: Region,
    descendants: Vec<Region>,
    presentation: Presentation,
}

type Effect = Box<dyn FnOnce(&Tree) + Send>;
type Effects = Option<VecDeque<Effect>>;

struct Drain<'a>(Option<&'a Mutex<Effects>>);

impl Drop for Drain<'_> {
    fn drop(&mut self) {
        if let Some(order) = self.0 {
            let abandoned = locked(order).take();
            drop(abandoned);
        }
    }
}

pub(crate) struct Tree {
    out: Out,
    host: Arc<Host>,
    layout: Arc<Mutex<Layout>>,
    id: usize,
    style: ProgressStyleSettings,
    bar: BarCells,
    root: Region,
    // Some while one caller drains. Hold before state when committing an operation.
    order: Mutex<Effects>,
    state: Mutex<State>,
    timer: Mutex<Option<JoinHandle<()>>>,
    pub(crate) runtime: Option<Handle>,
}

impl Tree {
    pub(crate) fn open(
        out: Out,
        host: Arc<Host>,
        layout: Arc<Mutex<Layout>>,
        style: ProgressStyleSettings,
        settings: ProgressSettings,
    ) -> (Arc<Self>, Arc<ProgressLog>) {
        let region = out.region(RegionOptions::new());
        let node = Node::new(ROOT, 0, region.clone(), &style, settings, Instant::now());
        let report = node.report();
        let label = node.label.clone();
        let log = node.log.clone();
        let interval = Duration::from_millis(node.spinner.interval.max(1));
        let id = locked(&layout).reserve();
        let live = region.live();
        let tree = Arc::new(Self {
            out,
            host,
            layout,
            id,
            bar: style.bar.clone().unwrap_or_else(default_bar),
            style,
            root: region.clone(),
            order: Mutex::new(None),
            state: Mutex::new(State {
                nodes: BTreeMap::from([(ROOT, node)]),
                running: BTreeSet::from([ROOT]),
                finished: BTreeMap::new(),
                next_line: 1,
                next_finish: 0,
            }),
            timer: Mutex::new(None),
            runtime: Handle::try_current().ok(),
        });
        let order = locked(&tree.order);
        let closing = tree.clone();
        if !region.__order_core_close(move |closer| closing.core_close(closer)) {
            log.close(false);
            let mut state = locked(&tree.state);
            state.running.clear();
            state.nodes.clear();
            drop(state);
            drop(order);
            return (tree, log);
        }
        if live {
            locked(&tree.layout).join(id, Arc::downgrade(&tree));
        }
        let seat = log.clone();
        let timer = tree.clone();
        tree.queue(order, move |tree| {
            region.report(report);
            if live {
                tree.open_seat(ROOT, seat);
                tree.draw_frame();
                timer.start_timer(interval);
            } else {
                tree.out.__progress_start(&label);
            }
        });
        (tree, log)
    }

    fn queue(
        &self,
        mut order: MutexGuard<'_, Effects>,
        effect: impl FnOnce(&Self) + Send + 'static,
    ) {
        if let Some(pending) = &mut *order {
            pending.push_back(Box::new(effect));
            return;
        }
        *order = Some(VecDeque::new());
        drop(order);

        // Views and progress observers can call back into the tree. They append to the queue
        // while its drainer renders and sends one operation at a time outside the lock.
        let mut drain = Drain(Some(&self.order));
        effect(self);
        loop {
            let mut order = locked(&self.order);
            let Some(next) = order.as_mut().and_then(VecDeque::pop_front) else {
                *order = None;
                drain.0 = None;
                break;
            };
            drop(order);
            next(self);
        }
    }

    fn start_timer(self: &Arc<Self>, interval: Duration) {
        let Some(runtime) = &self.runtime else { return };
        let signal = self.root.signal();
        let tree = self.clone();
        let mut timer = locked(&self.timer);
        if signal.is_cancelled() {
            return;
        }
        *timer = Some(runtime.spawn(async move {
            loop {
                if crate::reader::unless(&signal, tokio::time::sleep(interval))
                    .await
                    .is_none()
                {
                    return;
                }
                {
                    let mut state = locked(&tree.state);
                    if !state.running.contains(&ROOT) {
                        return;
                    }
                    let State { running, nodes, .. } = &mut *state;
                    for id in running.iter() {
                        if let Some(node) = nodes.get_mut(id) {
                            node.tick = node.tick.wrapping_add(1);
                        }
                    }
                }
                tree.redraw();
            }
        }));
    }

    fn now(&self) -> Instant {
        // An owned handle can be used on a worker that has a different clock.
        let _runtime = self.runtime.as_ref().map(Handle::enter);
        Instant::now()
    }

    fn rows(&self) -> Option<usize> {
        self.host.terminal.stderr().rows.map(usize::from)
    }

    fn open_seat(&self, id: usize, log: Arc<ProgressLog>) {
        let others = {
            let state = locked(&self.state);
            if !state.running.contains(&id) {
                return;
            }
            locked(&self.layout).open(self.id, id, log, self.rows())
        };
        for tree in others {
            tree.redraw();
        }
    }

    pub(crate) fn open_task(
        &self,
        parent: usize,
        settings: ProgressSettings,
    ) -> Option<(usize, Arc<ProgressLog>)> {
        let order = locked(&self.order);
        if self.root.__run_cancelled() {
            return None;
        }
        let (id, region, log, report, label, depth) = {
            let mut state = locked(&self.state);
            let parent_node = state
                .nodes
                .get(&parent)
                .filter(|node| node.ended.is_none())?;
            let depth = parent_node.depth + 1;
            let region = self.out.region(RegionOptions::new().__report_only());
            let node = Node::new(
                parent,
                depth,
                region.clone(),
                &self.style,
                settings,
                self.now(),
            );
            let report = node.report();
            let log = node.log.clone();
            let label = node.label.clone();
            let id = state.next_line;
            state.next_line += 1;
            state.nodes.get_mut(&parent)?.children.push(id);
            state.nodes.insert(id, node);
            state.running.insert(id);
            (id, region, log, report, label, depth)
        };
        let seat = log.clone();
        self.queue(order, move |tree| {
            region.report(report);
            if tree.root.live() {
                tree.open_seat(id, seat);
                tree.draw_frame();
            } else {
                tree.out.__progress_start(&indented(&label, depth));
            }
        });
        Some((id, log))
    }

    pub(crate) fn update(&self, id: usize, update: ProgressUpdate) {
        let order = locked(&self.order);
        if self.root.__run_cancelled() {
            return;
        }
        let (region, report) = {
            let mut state = locked(&self.state);
            let Some(node) = state.nodes.get_mut(&id).filter(|node| node.ended.is_none()) else {
                return;
            };
            let mut report = ProgressReport::new();
            if let Some(completed) = update.completed {
                node.completed = Some(completed);
                node.estimate.report(node.elapsed(self.now()), completed);
                report = report.completed(completed);
            }
            if let Some(total) = update.total {
                node.total = Some(total);
                report = report.total(total);
            }
            if let Some(label) = update.label {
                node.label.clone_from(&label);
                report = report.label(label);
            }
            (node.region.clone(), report)
        };
        self.queue(order, move |tree| {
            region.report(report);
            tree.draw_frame();
        });
    }

    fn redraw(&self) {
        self.queue(locked(&self.order), Self::draw_frame);
    }

    fn draw_frame(&self) {
        if !self.root.live() {
            return;
        }
        let data = {
            let state = locked(&self.state);
            if !state.running.contains(&ROOT) {
                return;
            }
            let order = state.running_order();
            let (logs, finished) = locked(&self.layout).fit(self.id, &order, self.rows());
            let visible = order
                .into_iter()
                .chain(state.finished.values().rev().take(finished).copied());
            let mut children: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
            for id in visible.filter(|id| *id != ROOT) {
                let node = &state.nodes[&id];
                children.entry(node.parent).or_default().push(id);
            }
            self.frame(&state, ROOT, &logs, &mut children, self.now())
        };
        drive(
            self.runtime.as_ref(),
            self.root.draw(&data, &progress_line()),
        );
    }

    fn frame(
        &self,
        state: &State,
        id: usize,
        logs: &BTreeMap<usize, usize>,
        children: &mut BTreeMap<usize, Vec<usize>>,
        now: Instant,
    ) -> ProgressLine {
        let node = &state.nodes[&id];
        let mut tasks = children.remove(&id).unwrap_or_default();
        tasks.sort_unstable();
        node.data(now, &self.bar)
            .log(node.log.rows(logs.get(&id).copied().unwrap_or(0)))
            .tasks(
                tasks
                    .into_iter()
                    .map(|task| self.frame(state, task, logs, children, now))
                    .collect(),
            )
    }

    pub(crate) fn running(&self, line: usize) -> bool {
        locked(&self.state).running.contains(&line)
    }

    fn snapshot(&self, node: &Node, end: End, now: Instant) -> EndLine {
        EndLine {
            end,
            data: node.data(now, &self.bar),
            kept: node.kept.clone(),
        }
    }

    fn finalize(&self, id: usize, end: End, label: Option<&str>) -> Option<Closing> {
        let mut state = locked(&self.state);
        if !state.running.contains(&id) {
            return None;
        }
        let mut layout = locked(&self.layout);
        let now = self.now();
        let mut plain = Vec::new();
        let mut descendants = Vec::new();
        let region = state.nodes.get(&id)?.region.clone();
        for line in state.postorder_open(id) {
            let order = state.next_finish;
            state.next_finish += 1;
            state.running.remove(&line);
            layout.leave(self.id, line);
            let node = state.nodes.get_mut(&line)?;
            if let Some(label) = label.filter(|_| line == id) {
                node.label = label.to_owned();
            }
            node.ended = Some((end, node.elapsed(now), order));
            node.kept = node.log.close(end.keeps_log()).message();
            if line != id {
                descendants.push(node.region.clone());
            }
            if !self.root.live() && end != End::Clear {
                plain.push(self.snapshot(node, end, now));
            }
            if !end.keeps_tasks(node.keep_tasks) {
                let children = std::mem::take(&mut node.children);
                state.remove_branches(children);
            }
            if self.root.live() && line != ROOT && end != End::Clear {
                state.finished.insert(order, line);
            }
        }

        let presentation = if !self.root.live() {
            Presentation::Plain(plain)
        } else if id != ROOT {
            Presentation::Redraw
        } else if end == End::Clear {
            Presentation::Clear
        } else {
            let root = state.nodes.get(&ROOT)?;
            if root.children.is_empty() {
                Presentation::Last(Box::new(self.snapshot(root, end, now)))
            } else {
                let mut tree = Vec::new();
                let mut todo = vec![ROOT];
                while let Some(id) = todo.pop() {
                    let node = state.nodes.get(&id)?;
                    let end = node.ended.map_or(end, |(end, _, _)| end);
                    tree.push(self.snapshot(node, end, now));
                    todo.extend(node.children.iter().rev().copied());
                }
                Presentation::Tree(tree)
            }
        };
        if id == ROOT {
            layout.remove(self.id);
            state.nodes.clear();
            state.finished.clear();
        } else {
            if end == End::Clear {
                let parent = state.nodes.get(&id)?.parent;
                if let Some(parent) = state.nodes.get_mut(&parent) {
                    parent.children.retain(|task| *task != id);
                }
                state.remove_branches(vec![id]);
            }
            layout.finish(self.id, state.finished.len());
        }
        Some(Closing {
            region,
            descendants,
            presentation,
        })
    }

    fn keep(&self, line: &EndLine, writes: &mut Vec<String>, failure: &mut Result<(), Error>) {
        if let Some(kept) = &line.kept {
            let lane = if line.end == End::Failure {
                EndState::Failed
            } else {
                EndState::Warned
            };
            let view = kept_view(line.data.depth);
            append_write(
                self.out
                    .__progress_message(lane, Message::new(kept).view(&view)),
                writes,
                failure,
            );
        }
    }

    fn prepare(&self, region: &Region, presentation: Presentation) -> Result<(), Error> {
        let mut writes = Vec::new();
        let mut failure = Ok(());
        let empty = View::new(|_: &(), _| String::new());
        let after_frame = matches!(&presentation, Presentation::Tree(_));
        match presentation {
            Presentation::Plain(lines) => {
                for line in &lines {
                    self.keep(line, &mut writes, &mut failure);
                    if line.end != End::Cancel {
                        let label = indented(&line.data.label, line.data.depth);
                        let text = self
                            .out
                            .__progress_message(line.end.region(), Message::new(&label));
                        append_write(text, &mut writes, &mut failure);
                    }
                }
            }
            Presentation::Last(line) => {
                self.keep(&line, &mut writes, &mut failure);
                failure = failure.and(region.__last_frame(&line.data, &progress_line()));
            }
            Presentation::Tree(lines) => {
                for line in &lines {
                    self.keep(line, &mut writes, &mut failure);
                    let text = self
                        .out
                        .__progress_draw(&line.data, &progress_line())
                        .map(Some);
                    append_write(text, &mut writes, &mut failure);
                }
                failure = failure.and(region.__last_frame(&(), &empty));
            }
            Presentation::Clear => return region.__last_frame(&(), &empty),
            Presentation::Redraw => self.draw_frame(),
        }
        region.__close_writes(writes, after_frame);
        failure
    }

    pub(crate) fn finish(
        &self,
        id: usize,
        end: End,
        label: Option<&str>,
    ) -> BoxFuture<'static, Result<(), Error>> {
        let order = locked(&self.order);
        if self.root.__run_cancelled() {
            return Box::pin(std::future::ready(Ok(())));
        }
        let Some(closing) = self.finalize(id, end, label) else {
            return Box::pin(std::future::ready(Ok(())));
        };
        let label = label.map(str::to_owned);
        let (queued, ready) = oneshot::channel();
        self.queue(order, move |tree| {
            if id == ROOT {
                tree.stop_timer();
            }
            for descendant in closing.descendants {
                drop(descendant.__queue_end(end.region(), None));
            }
            let prepared = tree.prepare(&closing.region, closing.presentation);
            let written = closing.region.__queue_end(end.region(), label.as_deref());
            let _ = queued.send((prepared, written));
        });
        Box::pin(async move {
            match ready.await {
                Ok((prepared, written)) => prepared.and(written.await),
                Err(_) => Ok(()),
            }
        })
    }

    fn stop_timer(&self) {
        if let Some(timer) = locked(&self.timer).take() {
            timer.abort();
        }
    }

    fn core_close(&self, closer: RegionCloser) -> oneshot::Receiver<Vec<Region>> {
        let end = match closer {
            RegionCloser::Failure => End::Failure,
            RegionCloser::Cancellation => End::Cancel,
            _ => End::Success,
        };
        let order = locked(&self.order);
        let closing = self.finalize(ROOT, end, None);
        let (prepared, ready) = oneshot::channel();
        self.queue(order, move |tree| {
            tree.stop_timer();
            let tasks = closing.map_or_else(Vec::new, |closing| {
                let _ = tree.prepare(&closing.region, closing.presentation);
                closing.descendants
            });
            let _ = prepared.send(tasks);
        });
        ready
    }
}

fn append_write(
    text: Result<Option<String>, Error>,
    writes: &mut Vec<String>,
    failure: &mut Result<(), Error>,
) {
    match text {
        Ok(Some(text)) => writes.push(text),
        Err(error) if failure.is_ok() => *failure = Err(error),
        _ => {}
    }
}

fn indented(text: &str, depth: usize) -> String {
    if depth == 0 {
        return text.to_owned();
    }
    let indent = "  ".repeat(depth);
    text.split('\n')
        .map(|line| indent.clone() + line)
        .collect::<Vec<_>>()
        .join("\n")
}

//! The progress events of one run: each reporting region's values, the ids the ledger numbers the
//! reporting regions with, and the end event a close builds.

use super::region::{EndState, ProgressEvent, ProgressReport, ProgressState, RegionCloser};

/// The ids of one run's reporting regions, numbered from 1 in the order each first reports.
#[derive(Debug)]
pub(crate) struct ProgressLedger {
    next: u64,
}

impl Default for ProgressLedger {
    fn default() -> Self {
        Self { next: 1 }
    }
}

impl ProgressLedger {
    fn next_id(&mut self) -> u64 {
        let id = self.next;
        self.next += 1;
        id
    }
}

/// One region's reports: the values its events carry, and the id its first report took.
#[derive(Debug, Default)]
pub(crate) struct RegionReports {
    id: Option<u64>,
    label: String,
    completed: Option<f64>,
    total: Option<f64>,
}

impl RegionReports {
    /// A `Started` event for the first report and an `Updated` event for each later one, holding
    /// the latest value any report gave. `plain` reads a marked label as plain text.
    pub(crate) fn report(
        &mut self,
        ledger: &mut ProgressLedger,
        progress: &ProgressReport,
        plain: &dyn Fn(&str) -> String,
    ) -> ProgressEvent {
        let state = if self.id.is_none() {
            ProgressState::Started
        } else {
            ProgressState::Updated
        };
        if self.id.is_none() {
            self.id = Some(ledger.next_id());
        }
        if let Some(label) = &progress.label {
            self.label.clone_from(label);
        }
        self.completed = progress.completed.or(self.completed);
        self.total = progress.total.or(self.total);
        self.build(state, None, plain)
    }

    /// The end event of a region that reported. Its explicit end carries the supplied state and
    /// label, or keeps the latest reported label. A core close reports the corresponding
    /// completion, failure, or cancellation. A region that never reported builds no event.
    pub(crate) fn close(
        &mut self,
        closer: RegionCloser,
        state: EndState,
        label: Option<&str>,
        plain: &dyn Fn(&str) -> String,
    ) -> Option<ProgressEvent> {
        self.id?;
        let built = match closer {
            RegionCloser::End => match state {
                EndState::Ended => ProgressState::Ended,
                EndState::Failed => ProgressState::Failed,
                EndState::Skipped => ProgressState::Skipped,
                EndState::Warned => ProgressState::Warned,
            },
            RegionCloser::Completion => ProgressState::Ended,
            RegionCloser::Failure => ProgressState::Failed,
            RegionCloser::Cancellation => ProgressState::Cancelled,
        };
        Some(self.build(built, label, plain))
    }

    fn build(
        &self,
        state: ProgressState,
        label: Option<&str>,
        plain: &dyn Fn(&str) -> String,
    ) -> ProgressEvent {
        ProgressEvent {
            id: self.id.unwrap_or(0),
            state,
            label: plain(label.unwrap_or(&self.label)),
            completed: self.completed,
            total: self.total,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    /// A stand-in for the view context's `plain`, which removes `*`.
    fn plain(text: &str) -> String {
        text.replace('*', "")
    }

    fn event(
        id: u64,
        state: ProgressState,
        label: &str,
        completed: Option<f64>,
        total: Option<f64>,
    ) -> ProgressEvent {
        ProgressEvent {
            id,
            state,
            label: label.to_owned(),
            completed,
            total,
        }
    }

    #[test]
    fn three_reports_and_an_end_build_started_updated_updated_and_ended_with_the_latest_values() {
        let mut ledger = ProgressLedger::default();
        let mut region = RegionReports::default();
        let events = vec![
            region.report(
                &mut ledger,
                &ProgressReport::new().label("Fetching").total(3.0),
                &plain,
            ),
            region.report(&mut ledger, &ProgressReport::new().completed(1.0), &plain),
            region.report(
                &mut ledger,
                &ProgressReport::new().completed(2.0).label("Fetching more"),
                &plain,
            ),
            region
                .close(RegionCloser::End, EndState::Ended, None, &plain)
                .unwrap(),
        ];
        assert_eq!(
            events,
            [
                event(1, ProgressState::Started, "Fetching", None, Some(3.0)),
                event(1, ProgressState::Updated, "Fetching", Some(1.0), Some(3.0)),
                event(
                    1,
                    ProgressState::Updated,
                    "Fetching more",
                    Some(2.0),
                    Some(3.0)
                ),
                event(
                    1,
                    ProgressState::Ended,
                    "Fetching more",
                    Some(2.0),
                    Some(3.0)
                ),
            ]
        );
    }

    #[test]
    fn an_end_label_replaces_the_regions_label_on_its_end_event_alone_read_as_plain_text() {
        let mut ledger = ProgressLedger::default();
        let mut region = RegionReports::default();
        let started = region.report(
            &mut ledger,
            &ProgressReport::new()
                .completed(3.0)
                .label("Fetching")
                .total(3.0),
            &plain,
        );
        let ended = region.close(
            RegionCloser::End,
            EndState::Failed,
            Some("*Fetch* refused."),
            &plain,
        );
        assert_eq!(
            started,
            event(1, ProgressState::Started, "Fetching", Some(3.0), Some(3.0))
        );
        assert_eq!(
            ended,
            Some(event(
                1,
                ProgressState::Failed,
                "Fetch refused.",
                Some(3.0),
                Some(3.0)
            ))
        );
    }

    #[test]
    fn regions_number_from_1_in_the_order_each_first_reports() {
        let mut ledger = ProgressLedger::default();
        let mut first = RegionReports::default();
        let mut second = RegionReports::default();
        let a = second.report(&mut ledger, &ProgressReport::new().label("second"), &plain);
        let b = first.report(&mut ledger, &ProgressReport::new().label("first"), &plain);
        assert_eq!(
            [(a.id, a.label), (b.id, b.label)],
            [(1, "second".to_owned()), (2, "first".to_owned())]
        );
    }

    #[test]
    fn a_first_report_that_carries_only_completed_reads_an_empty_label() {
        let mut ledger = ProgressLedger::default();
        let reported = RegionReports::default().report(
            &mut ledger,
            &ProgressReport::new().completed(4.0),
            &plain,
        );
        assert_eq!(
            reported,
            event(1, ProgressState::Started, "", Some(4.0), None)
        );
    }

    #[test]
    fn each_label_is_plain_text() {
        let mut ledger = ProgressLedger::default();
        let reported = RegionReports::default().report(
            &mut ledger,
            &ProgressReport::new().label("*bold*"),
            &plain,
        );
        assert_eq!(reported.label, "bold");
    }

    #[test]
    fn each_closer_and_end_state_builds_its_end_state() {
        let cases = [
            (RegionCloser::End, EndState::Ended, ProgressState::Ended),
            (RegionCloser::End, EndState::Failed, ProgressState::Failed),
            (RegionCloser::End, EndState::Skipped, ProgressState::Skipped),
            (RegionCloser::End, EndState::Warned, ProgressState::Warned),
            (
                RegionCloser::Completion,
                EndState::Ended,
                ProgressState::Ended,
            ),
            (
                RegionCloser::Failure,
                EndState::Ended,
                ProgressState::Failed,
            ),
            (
                RegionCloser::Cancellation,
                EndState::Ended,
                ProgressState::Cancelled,
            ),
        ];
        for (closer, state, built) in cases {
            let mut ledger = ProgressLedger::default();
            let mut region = RegionReports::default();
            region.report(&mut ledger, &ProgressReport::new().label("work"), &plain);
            let ended = region.close(closer, state, None, &plain).unwrap();
            assert_eq!(ended.state, built, "{closer:?} with {state:?}");
        }
    }

    #[test]
    fn a_region_that_never_reported_builds_no_event_when_it_closes() {
        let mut region = RegionReports::default();
        assert_eq!(
            region.close(RegionCloser::End, EndState::Ended, None, &plain),
            None
        );
    }
}

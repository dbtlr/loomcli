//! Rate and time left from counted reports on the progress line's clock.

use std::collections::VecDeque;

const WINDOW: u64 = 10_000;
const KNOWN: u64 = 1_000;

#[derive(Clone, Copy)]
struct Sample {
    time: u64,
    count: f64,
}

#[derive(Default)]
pub(crate) struct Estimate {
    samples: VecDeque<Sample>,
}

impl Estimate {
    pub(crate) fn report(&mut self, time: u64, count: f64) {
        if self.samples.back().is_some_and(|last| count < last.count) {
            self.samples.clear();
        }
        self.samples.push_back(Sample { time, count });
        // Keep the latest sample at least one window before the newest, and every newer sample.
        while self
            .samples
            .get(1)
            .is_some_and(|next| time - next.time >= WINDOW)
        {
            self.samples.pop_front();
        }
    }

    pub(crate) fn figures(&self, total: Option<f64>, now: u64) -> (Option<f64>, Option<f64>) {
        let (Some(first), Some(last)) = (self.samples.front(), self.samples.back()) else {
            return (None, None);
        };
        let time = last.time - first.time;
        if time < KNOWN {
            return (None, None);
        }
        let delta = last.count - first.count;
        let rate = delta * 1000.0 / time as f64;
        let remaining = total
            .filter(|total| delta != 0.0 && last.count < *total)
            .map(|total| {
                let at_report = (total - last.count) * time as f64 / delta;
                (at_report - now.saturating_sub(last.time) as f64).max(0.0)
            });
        (Some(rate), remaining)
    }
}

#[cfg(test)]
mod tests {
    use super::Estimate;

    #[test]
    fn the_window_retains_its_anchor_and_newer_samples_during_sustained_reporting() {
        let mut estimate = Estimate::default();
        for time in 0..3_600_000 {
            estimate.report(time, time as f64);
            assert!(estimate.samples.len() <= 10_001);
        }
        assert_eq!(estimate.samples.len(), 10_001);
        assert_eq!(estimate.figures(None, 3_600_000), (Some(1000.0), None));
    }
}

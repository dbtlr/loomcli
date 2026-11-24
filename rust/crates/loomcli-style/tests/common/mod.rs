//! The harness the ported tests share: what the reference's `resolve-style.mjs` and `wrap.mjs`
//! fixtures do, a render to stdout under captured facts, without a run around it.

#![allow(dead_code)]

use loomcli_style::{
    Palette, Renderer, RenderingPolicy, Theme, ThemeMapping, capabilities, effective_columns,
};

/// The facts and policy one render resolves under. The default is the fixture's: no variable, a
/// pipe, and no declared policy.
#[derive(Default, Clone)]
pub struct Facts {
    pub env: Vec<(&'static str, &'static str)>,
    pub tty: bool,
    pub rendering: RenderingPolicy,
    pub run_rendering: RenderingPolicy,
    pub theme: Option<ThemeMapping>,
}

impl Facts {
    pub fn new() -> Facts {
        Facts::default()
    }

    pub fn env(mut self, env: &[(&'static str, &'static str)]) -> Facts {
        self.env = env.to_vec();
        self
    }

    pub fn tty(mut self) -> Facts {
        self.tty = true;
        self
    }

    pub fn rendering(mut self, rendering: RenderingPolicy) -> Facts {
        self.rendering = rendering;
        self
    }

    pub fn run_rendering(mut self, rendering: RenderingPolicy) -> Facts {
        self.run_rendering = rendering;
        self
    }

    pub fn theme(mut self, theme: ThemeMapping) -> Facts {
        self.theme = Some(theme);
        self
    }

    /// The renderer stdout receives under these facts.
    pub fn renderer(&self) -> Renderer {
        let policy = self.rendering.merged(&self.run_rendering);
        let caps = capabilities(&self.env, self.tty, &policy);
        let palette = match &self.theme {
            Some(mapping) => Theme::build(mapping)
                .map(|theme| theme.palette(None))
                .unwrap_or_default(),
            None => Palette::new(),
        };
        Renderer::new(caps, palette)
    }

    /// The bytes stdout receives for one rendered string.
    pub fn resolve(&self, text: &str) -> String {
        self.renderer().resolve(text)
    }

    /// The bytes stdout receives for several rendered strings, each its own output call.
    pub fn resolve_each(&self, texts: &[&str]) -> String {
        let renderer = self.renderer();
        texts.iter().map(|text| renderer.resolve(text)).collect()
    }

    /// What a view that prints `context.width(value)` writes.
    pub fn measure(&self, text: &str) -> String {
        self.renderer().width(text).to_string()
    }

    /// The columns stdout reads on a terminal reporting `reported`.
    pub fn columns(&self, reported: Option<u64>) -> Option<u64> {
        effective_columns(&self.env, self.tty, reported)
    }
}

/// The resolution of one string under the default facts.
pub fn resolve(text: &str) -> String {
    Facts::new().resolve(text)
}

/// A style frame over a red foreground, as the wire spells it.
pub fn red_span(body: &str) -> String {
    format!("\u{E000}[\"style\",[[\"foreground\",\"red\"]]]\u{E001}{body}\u{E002}")
}

/// A style frame over the bold modifier, as the wire spells it.
pub fn bold_span(body: &str) -> String {
    format!("\u{E000}[\"style\",[[\"modifier\",\"bold\"]]]\u{E001}{body}\u{E002}")
}

/// A padding frame, as the wire spells it.
pub fn padded(body: &str, columns: usize, align: &str) -> String {
    format!("\u{E000}[\"pad\",{columns},\"{align}\"]\u{E001}{body}\u{E002}")
}

/// A no-wrap frame, as the wire spells it.
pub fn unbroken(body: &str) -> String {
    format!("\u{E000}[\"nowrap\"]\u{E001}{body}\u{E002}")
}

/// The number of UTF-16 code units, which the reference's `length` counts.
pub fn length(text: &str) -> String {
    text.encode_utf16().count().to_string()
}

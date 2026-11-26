//! The `#[derive(Inputs)]` expansion.
//!
//! Each field becomes one builder call in `declare`, one read in `extract`, and one write in
//! `into_values`. The field's type decides the builder and its presence; the attribute adds the
//! remaining facts. A struct whose every field may be a global option, and that declares no option
//! group, also implements `GlobalInputs`.
//!
//! Every fact the builder would reject at the call for this field's kind is a compile error here,
//! spanned at the fact's key, so a struct that compiles makes the builder calls its kind takes. The
//! rules that depend on more than one declaration (a name taken twice, a run-wide mark on a local
//! option) stay the call's.

use proc_macro2::{Span, TokenStream};
use quote::{quote, quote_spanned};
use syn::spanned::Spanned;
use syn::{
    Attribute, Data, DeriveInput, Expr, Field, Fields, GenericArgument, Ident, LitStr,
    PathArguments, Type, meta::ParseNestedMeta, parse::ParseStream,
};

/// Which declaration a field is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Option,
    Argument,
    Stdin,
    Passthrough,
}

/// How the field's type wraps its value.
#[derive(Clone, Copy)]
enum Wrapper<'a> {
    /// `T`: required unless it has a default or its validator receives the omission.
    Scalar(&'a Type),
    /// `Option<T>`: optional.
    Optional(&'a Type),
    /// `Vec<T>`: several values.
    List(&'a Type),
}

impl<'a> Wrapper<'a> {
    fn of(ty: &'a Type) -> Self {
        if let Some((name, inner)) = single_generic(ty) {
            if name == "Option" {
                return Wrapper::Optional(inner);
            }
            if name == "Vec" {
                return Wrapper::List(inner);
            }
        }
        Wrapper::Scalar(ty)
    }

    fn element(self) -> &'a Type {
        match self {
            Wrapper::Scalar(ty) | Wrapper::Optional(ty) | Wrapper::List(ty) => ty,
        }
    }
}

fn single_generic(ty: &Type) -> Option<(String, &Type)> {
    let Type::Path(path) = ty else { return None };
    let segment = path.path.segments.last()?;
    let PathArguments::AngleBracketed(arguments) = &segment.arguments else {
        return None;
    };
    if arguments.args.len() != 1 {
        return None;
    }
    match arguments.args.first()? {
        GenericArgument::Type(inner) => Some((segment.ident.to_string(), inner)),
        _ => None,
    }
}

fn last_ident(ty: &Type) -> Option<String> {
    let Type::Path(path) = ty else { return None };
    path.path
        .segments
        .last()
        .map(|segment| segment.ident.to_string())
}

/// The unsigned integer types a counted option reads.
const COUNT_TYPES: [&str; 5] = ["u8", "u16", "u32", "u64", "usize"];

/// One fact with a value, and the span of its key, where an error about it points.
struct Valued<T> {
    value: T,
    key: Span,
}

/// The facts one field's attribute declares. A flag holds the span of its key.
#[derive(Default)]
struct FieldAttributes {
    name: Option<Valued<LitStr>>,
    description: Option<Valued<LitStr>>,
    short: Option<Valued<Expr>>,
    short_only: Option<Span>,
    aliases: Option<Valued<Expr>>,
    hidden: Option<Span>,
    deprecated: Option<Valued<LitStr>>,
    control: Option<Span>,
    count: Option<Span>,
    polarity: Option<Valued<LitStr>>,
    validate: Option<Valued<Expr>>,
    validate_omitted: Option<Span>,
    default: Option<Valued<Expr>>,
    implied: Option<Valued<LitStr>>,
    last_wins: Option<Span>,
    arity: Option<Span>,
    required: Option<Span>,
    non_interactive: Option<Span>,
    env: Option<Valued<Expr>>,
    env_delimiter: Option<Valued<LitStr>>,
    env_allow_empty: Option<Span>,
    extensions: Option<Valued<Expr>>,
    stdin: Option<Span>,
    min: Option<Valued<Expr>>,
    max: Option<Valued<Expr>>,
    interaction: Option<Span>,
    color: Option<Span>,
    plain: Option<Span>,
    verbose: Option<Span>,
    quiet: Option<Span>,
    background: Option<Span>,
    builder: Option<Valued<Expr>>,
    /// Every fact the attribute names, in order, with its key's span.
    present: Vec<(&'static str, Span)>,
}

/// Every fact the grammar knows, and what it is a fact of, for the sentence that rejects it on a
/// field of another kind.
const FACTS: [(&str, &str); 32] = [
    ("name", "an option or an argument"),
    ("description", "an input"),
    ("short", "an option"),
    ("short_only", "an option"),
    ("aliases", "an option"),
    ("hidden", "an option"),
    ("deprecated", "an option"),
    ("control", "an option"),
    ("count", "an option whose field is an unsigned integer"),
    ("polarity", "a Boolean option"),
    ("validate", "a string input"),
    ("validate_omitted", "a string input"),
    ("default", "a string input"),
    ("implied", "a string option"),
    ("last_wins", "a scalar string option"),
    ("arity", "a string option"),
    ("required", "a `Vec` input"),
    ("non_interactive", "an `Option` or `Vec` string input"),
    ("env", "an option"),
    ("env_delimiter", "a string or content option"),
    ("env_allow_empty", "a string option"),
    ("extensions", "an option or an argument"),
    ("stdin", "a content input"),
    ("min", "a `Vec` content input"),
    ("max", "a `Vec` content input"),
    ("interaction", "a Boolean option"),
    ("color", "a Boolean option"),
    ("plain", "a Boolean option"),
    ("verbose", "a counted option"),
    ("quiet", "a counted option"),
    ("background", "a string option"),
    ("builder", "a content option"),
];

/// The facts every option kind takes.
const OPTION_FACTS: [&str; 10] = [
    "name",
    "description",
    "short",
    "short_only",
    "aliases",
    "hidden",
    "deprecated",
    "control",
    "env",
    "extensions",
];

/// A flag fact: its key's span, or a fault when the attribute named it already.
fn set_flag(slot: &mut Option<Span>, meta: &ParseNestedMeta<'_>, key: &str) -> syn::Result<()> {
    if meta.input.peek(syn::Token![=]) || meta.input.peek(syn::token::Paren) {
        return Err(meta.error(format!("`{key}` is a flag: write it alone, with no value")));
    }
    *slot = Some(meta.path.span());
    Ok(())
}

/// A fact with a value: the value, or a fault when it does not parse.
fn set_value<T: syn::parse::Parse>(
    slot: &mut Option<Valued<T>>,
    meta: &ParseNestedMeta<'_>,
    key: &str,
) -> syn::Result<()> {
    if !meta.input.peek(syn::Token![=]) {
        return Err(meta.error(format!("`{key}` takes a value: write `{key} = …`")));
    }
    let value = meta.value()?.parse()?;
    *slot = Some(Valued {
        value,
        key: meta.path.span(),
    });
    Ok(())
}

/// Reads one fact into `facts`.
fn parse_fact(facts: &mut FieldAttributes, meta: &ParseNestedMeta<'_>) -> syn::Result<()> {
    let key = meta
        .path
        .get_ident()
        .map(ToString::to_string)
        .unwrap_or_default();
    let Some((known, _)) = FACTS.iter().find(|(fact, _)| *fact == key) else {
        return Err(meta.error(format!(
            "unknown input fact `{key}`; the facts are {}",
            FACTS
                .iter()
                .map(|(fact, _)| format!("`{fact}`"))
                .collect::<Vec<_>>()
                .join(", ")
        )));
    };
    if facts.present.iter().any(|(fact, _)| fact == known) {
        return Err(meta.error(format!("`{key}` is declared twice")));
    }
    facts.present.push((known, meta.path.span()));
    match key.as_str() {
        "name" => set_value(&mut facts.name, meta, &key),
        "description" => set_value(&mut facts.description, meta, &key),
        "short" => set_value(&mut facts.short, meta, &key),
        "short_only" => set_flag(&mut facts.short_only, meta, &key),
        "aliases" => set_value(&mut facts.aliases, meta, &key),
        "hidden" => set_flag(&mut facts.hidden, meta, &key),
        "deprecated" => set_value(&mut facts.deprecated, meta, &key),
        "control" => set_flag(&mut facts.control, meta, &key),
        "count" => set_flag(&mut facts.count, meta, &key),
        "polarity" => set_value(&mut facts.polarity, meta, &key),
        "validate" => set_value(&mut facts.validate, meta, &key),
        "validate_omitted" => set_flag(&mut facts.validate_omitted, meta, &key),
        "default" => set_value(&mut facts.default, meta, &key),
        "implied" => set_value(&mut facts.implied, meta, &key),
        "last_wins" => set_flag(&mut facts.last_wins, meta, &key),
        "arity" => set_flag(&mut facts.arity, meta, &key),
        "required" => set_flag(&mut facts.required, meta, &key),
        "non_interactive" => set_flag(&mut facts.non_interactive, meta, &key),
        "env" => set_value(&mut facts.env, meta, &key),
        "env_delimiter" => set_value(&mut facts.env_delimiter, meta, &key),
        "env_allow_empty" => set_flag(&mut facts.env_allow_empty, meta, &key),
        "extensions" => set_value(&mut facts.extensions, meta, &key),
        "stdin" => set_flag(&mut facts.stdin, meta, &key),
        "min" => set_value(&mut facts.min, meta, &key),
        "max" => set_value(&mut facts.max, meta, &key),
        "interaction" => set_flag(&mut facts.interaction, meta, &key),
        "color" => set_flag(&mut facts.color, meta, &key),
        "plain" => set_flag(&mut facts.plain, meta, &key),
        "verbose" => set_flag(&mut facts.verbose, meta, &key),
        "quiet" => set_flag(&mut facts.quiet, meta, &key),
        "background" => set_flag(&mut facts.background, meta, &key),
        _ => set_value(&mut facts.builder, meta, &key),
    }
}

fn role_of(attribute: &Attribute) -> Option<Role> {
    if attribute.path().is_ident("option") {
        Some(Role::Option)
    } else if attribute.path().is_ident("argument") {
        Some(Role::Argument)
    } else if attribute.path().is_ident("stdin") {
        Some(Role::Stdin)
    } else if attribute.path().is_ident("passthrough") {
        Some(Role::Passthrough)
    } else {
        None
    }
}

fn parse_field(field: &Field) -> syn::Result<(Role, FieldAttributes)> {
    let mut found: Option<Role> = None;
    let mut facts = FieldAttributes::default();
    for attribute in &field.attrs {
        let Some(role) = role_of(attribute) else {
            continue;
        };
        if found.is_some() {
            return Err(syn::Error::new_spanned(
                attribute,
                "a field is one input: one of #[option], #[argument], #[stdin], or #[passthrough]",
            ));
        }
        found = Some(role);
        match &attribute.meta {
            syn::Meta::Path(_) => {}
            syn::Meta::List(list) if list.tokens.is_empty() => {}
            syn::Meta::List(_) => {
                attribute.parse_nested_meta(|meta| parse_fact(&mut facts, &meta))?
            }
            syn::Meta::NameValue(pair) => {
                return Err(syn::Error::new_spanned(
                    pair,
                    "an input attribute lists its facts in parentheses, such as #[option(short = 'f')]",
                ));
            }
        }
    }
    match found {
        Some(role) => Ok((role, facts)),
        None => Err(syn::Error::new(
            field
                .ident
                .as_ref()
                .map_or_else(|| field.span(), Ident::span),
            "each field of an Inputs struct carries #[option], #[argument], #[stdin], or #[passthrough]",
        )),
    }
}

/// The doc comment lines of a field, joined with spaces: the description when none is given.
fn doc_description(field: &Field) -> Option<LitStr> {
    let mut lines = Vec::new();
    for attribute in &field.attrs {
        if !attribute.path().is_ident("doc") {
            continue;
        }
        if let syn::Meta::NameValue(pair) = &attribute.meta {
            if let Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Str(text),
                ..
            }) = &pair.value
            {
                for line in text.value().lines() {
                    let line = line.trim();
                    if !line.is_empty() {
                        lines.push(line.to_owned());
                    }
                }
            }
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(LitStr::new(&lines.join(" "), Span::call_site()))
    }
}

/// The declared name: the `name` fact, or the field name with `_` read as `-`.
fn declared_name(field: &Field, facts: &FieldAttributes) -> syn::Result<LitStr> {
    if let Some(name) = &facts.name {
        return Ok(name.value.clone());
    }
    let ident = field
        .ident
        .as_ref()
        .ok_or_else(|| syn::Error::new_spanned(field, "Inputs fields are named"))?;
    let text = ident.to_string();
    let text = text.strip_prefix("r#").unwrap_or(&text).replace('_', "-");
    Ok(LitStr::new(&text, ident.span()))
}

/// The kinds of input a field declares, each with the facts it takes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    BooleanOption,
    CountOption,
    StringOption,
    ContentOption,
    StringArgument,
    ContentArgument,
    Stdin,
    Passthrough,
}

impl Kind {
    fn noun(self) -> &'static str {
        match self {
            Kind::BooleanOption => "a Boolean option",
            Kind::CountOption => "a counted option",
            Kind::StringOption => "a string option",
            Kind::ContentOption => "a content option",
            Kind::StringArgument => "a string argument",
            Kind::ContentArgument => "a content argument",
            Kind::Stdin => "the standalone stdin",
            Kind::Passthrough => "the passthrough mode",
        }
    }

    /// The facts this kind takes beside the option facts, or all of them for an argument and stdin.
    fn takes(self, fact: &str) -> bool {
        let option = OPTION_FACTS.contains(&fact);
        match self {
            Kind::BooleanOption => {
                option || ["polarity", "interaction", "color", "plain"].contains(&fact)
            }
            Kind::CountOption => option || ["count", "verbose", "quiet"].contains(&fact),
            Kind::StringOption => {
                option
                    || [
                        "validate",
                        "validate_omitted",
                        "default",
                        "implied",
                        "last_wins",
                        "arity",
                        "required",
                        "non_interactive",
                        "env_delimiter",
                        "env_allow_empty",
                        "background",
                    ]
                    .contains(&fact)
            }
            Kind::ContentOption => {
                option
                    || [
                        "required",
                        "stdin",
                        "min",
                        "max",
                        "env_delimiter",
                        "builder",
                    ]
                    .contains(&fact)
            }
            Kind::StringArgument => [
                "name",
                "description",
                "validate",
                "validate_omitted",
                "default",
                "required",
                "non_interactive",
                "extensions",
            ]
            .contains(&fact),
            Kind::ContentArgument => [
                "name",
                "description",
                "required",
                "stdin",
                "min",
                "max",
                "extensions",
            ]
            .contains(&fact),
            Kind::Stdin | Kind::Passthrough => fact == "description",
        }
    }
}

/// The kind a field declares, from its role and type, or the fault of a type no kind reads.
fn kind_of(role: Role, wrapper: Wrapper<'_>, facts: &FieldAttributes) -> syn::Result<Kind> {
    let element = wrapper.element();
    let ident = last_ident(element);
    let is_content = ident.as_deref() == Some("Content");
    let is_bool = ident.as_deref() == Some("bool");
    if role == Role::Passthrough {
        if matches!(wrapper, Wrapper::List(_)) && ident.as_deref() == Some("String") {
            return Ok(Kind::Passthrough);
        }
        return Err(syn::Error::new(
            element.span(),
            "a #[passthrough] field reads the tail as `Vec<String>`",
        ));
    }
    if role == Role::Stdin && !is_content {
        return Err(syn::Error::new(
            element.span(),
            "a #[stdin] field reads one stdin: `Content` or `Option<Content>`",
        ));
    }
    if is_bool && !matches!(wrapper, Wrapper::Scalar(_)) {
        return Err(syn::Error::new(
            element.span(),
            "a Boolean option is never absent and never repeated: its field is a plain `bool`",
        ));
    }
    Ok(match role {
        Role::Stdin => Kind::Stdin,
        Role::Passthrough => Kind::Passthrough,
        Role::Argument if is_bool => {
            return Err(syn::Error::new(
                element.span(),
                "an argument reads a string or content; a `bool` field is a Boolean option",
            ));
        }
        Role::Argument if is_content => Kind::ContentArgument,
        Role::Argument => Kind::StringArgument,
        Role::Option if is_bool => {
            if let Some(count) = facts.count {
                return Err(syn::Error::new(
                    count,
                    "a `bool` field is a Boolean option; `count` makes an unsigned integer field a counted option",
                ));
            }
            Kind::BooleanOption
        }
        Role::Option if facts.count.is_some() => Kind::CountOption,
        Role::Option if is_content => Kind::ContentOption,
        Role::Option => Kind::StringOption,
    })
}

/// The fault of the first fact this kind does not take, at its key.
fn reject_foreign_facts(kind: Kind, facts: &FieldAttributes) -> syn::Result<()> {
    for (fact, key) in &facts.present {
        if kind.takes(fact) {
            continue;
        }
        let owner = FACTS
            .iter()
            .find(|(known, _)| known == fact)
            .map_or("another input", |(_, owner)| owner);
        return Err(syn::Error::new(
            *key,
            format!(
                "`{fact}` is not a fact of {}: it is a fact of {owner}",
                kind.noun()
            ),
        ));
    }
    Ok(())
}

fn reject(condition: bool, span: Span, message: &str) -> syn::Result<()> {
    if condition {
        Err(syn::Error::new(span, message))
    } else {
        Ok(())
    }
}

/// The facts a field with a shared `builder` states beside it: its declared name, and the presence
/// facts its `Vec` type governs. Every other fact is the builder's.
const BESIDE_BUILDER: [&str; 5] = ["name", "builder", "required", "min", "max"];

/// The fault of the first fact a shared builder already holds, at its key, so a field never
/// states a fact the expansion would drop.
fn reject_beside_builder(facts: &FieldAttributes) -> syn::Result<()> {
    if facts.builder.is_none() {
        return Ok(());
    }
    for (fact, key) in &facts.present {
        if BESIDE_BUILDER.contains(fact) {
            continue;
        }
        return Err(syn::Error::new(
            *key,
            format!(
                "`{fact}` is a fact of the shared builder: set it in the builder or drop `builder`"
            ),
        ));
    }
    Ok(())
}

/// Whether `name` is a declared name: nonempty, with no leading hyphen, no whitespace, and no `=`,
/// as core's `is_declared_name` reads it, with whitespace as a JavaScript `\s` reads it.
fn is_declared_name(name: &str) -> bool {
    let whitespace = |character: char| {
        matches!(
            character,
            '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200a}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202f}'
                    | '\u{205f}'
                    | '\u{3000}'
                    | '\u{feff}'
        )
    };
    !name.is_empty() && !name.starts_with('-') && !name.chars().any(|c| whitespace(c) || c == '=')
}

/// The sentence a name outside the declared-name grammar faults with.
const DECLARED_NAME: &str =
    "a declared name is nonempty, with no leading hyphen, no whitespace, and no `=`";

/// The `declared-name` rule for the field's name and each literal alias, at the literal at fault, or
/// at the field name when the name is the field's own.
fn reject_declared_names(name: &LitStr, facts: &FieldAttributes) -> syn::Result<()> {
    if !is_declared_name(&name.value()) {
        let message = if facts.name.is_some() {
            format!("{:?} is not a declared name: {DECLARED_NAME}", name.value())
        } else {
            format!(
                "the field name declares the name {:?}, which is not a declared name: {DECLARED_NAME}; give one with `name = \"…\"`",
                name.value()
            )
        };
        return Err(syn::Error::new(name.span(), message));
    }
    if let Some(Expr::Array(aliases)) = facts.aliases.as_ref().map(|aliases| &aliases.value) {
        for alias in &aliases.elems {
            if let Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Str(text),
                ..
            }) = alias
            {
                if !is_declared_name(&text.value()) {
                    return Err(syn::Error::new(
                        text.span(),
                        format!(
                            "the alias {:?} is not a declared name: {DECLARED_NAME}",
                            text.value()
                        ),
                    ));
                }
            }
        }
    }
    Ok(())
}

/// The rules on the spellings one option declares: a short spelling is one ASCII letter, and a
/// short-only option keeps it.
fn reject_spellings(facts: &FieldAttributes) -> syn::Result<()> {
    if let Some(short) = &facts.short {
        if let Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Char(letter),
            ..
        }) = &short.value
        {
            reject(
                !letter.value().is_ascii_alphabetic(),
                letter.span(),
                "a short spelling is one ASCII letter, such as 'f'",
            )?;
        }
    }
    if let Some(short_only) = facts.short_only {
        reject(
            facts.short.is_none(),
            short_only,
            "`short_only` needs `short`, the one spelling a short-only option keeps",
        )?;
    }
    Ok(())
}

/// The rules on an option's environment binding beside the field type.
fn reject_env_facts(wrapper: Wrapper<'_>, facts: &FieldAttributes) -> syn::Result<()> {
    let list = matches!(wrapper, Wrapper::List(_));
    if let Some(delimiter) = &facts.env_delimiter {
        reject(
            !list && facts.arity.is_none(),
            delimiter.key,
            "`env_delimiter` splits the variable's value into several, so it sits on a `Vec` field",
        )?;
        reject(
            facts.env.is_none(),
            delimiter.key,
            "`env_delimiter` splits an environment binding's value; add `env`",
        )?;
    }
    if let Some(allow_empty) = facts.env_allow_empty {
        reject(
            facts.env.is_none(),
            allow_empty,
            "`env_allow_empty` needs `env`, the binding whose empty value it keeps",
        )?;
        reject(
            list,
            allow_empty,
            "`env_allow_empty` keeps one value's empty binding; a `Vec` field's binding splits its value",
        )?;
    }
    Ok(())
}

/// The run-wide marks one counted or string option combines with other facts.
fn reject_marks(wrapper: Wrapper<'_>, facts: &FieldAttributes) -> syn::Result<()> {
    if let (Some(_), Some(quiet)) = (facts.verbose, facts.quiet) {
        return Err(syn::Error::new(
            quiet,
            "an option is verbose or quiet, not both; drop one",
        ));
    }
    if let Some(background) = facts.background {
        let beside = [
            ("short", facts.short.as_ref().map(|fact| fact.key)),
            ("env", facts.env.as_ref().map(|fact| fact.key)),
            ("default", facts.default.as_ref().map(|fact| fact.key)),
            ("implied", facts.implied.as_ref().map(|fact| fact.key)),
        ];
        for (fact, key) in beside {
            if let Some(key) = key {
                return Err(syn::Error::new(
                    key,
                    format!(
                        "a background option takes no `{fact}`: core fills it from the terminal"
                    ),
                ));
            }
        }
        reject(
            matches!(wrapper, Wrapper::List(_)),
            background,
            "a background option holds one value; its field is not a `Vec`",
        )?;
    }
    Ok(())
}

/// The rules between two facts of one option, which the builder faults at the call under
/// `option-config`, as compile errors at the second fact's key.
fn reject_fact_pairs(kind: Kind, wrapper: Wrapper<'_>, facts: &FieldAttributes) -> syn::Result<()> {
    if let Some(last_wins) = facts.last_wins {
        reject(
            matches!(wrapper, Wrapper::List(_)),
            last_wins,
            "`last_wins` applies to a scalar option; a `Vec` field collects all occurrences",
        )?;
    }
    reject_spellings(facts)?;
    reject_env_facts(wrapper, facts)?;
    reject_marks(wrapper, facts)?;
    if let (Some(_), Some(aliases)) = (facts.short_only, &facts.aliases) {
        return Err(syn::Error::new(
            aliases.key,
            "a short-only option has no long spelling for an alias to stand beside; drop `aliases` or `short_only`",
        ));
    }
    if let (Some(polarity), Some(short_only)) = (&facts.polarity, facts.short_only) {
        if polarity.value.value() == "both" {
            return Err(syn::Error::new(
                short_only,
                "polarity \"both\" needs the long spelling its negation forms; drop `short_only`",
            ));
        }
    }
    if facts.color.is_some() {
        if let Some(short) = &facts.short {
            return Err(syn::Error::new(
                short.key,
                "a color option takes no short spelling",
            ));
        }
        if let Some(env) = &facts.env {
            return Err(syn::Error::new(
                env.key,
                "a color option takes no environment binding: NO_COLOR and FORCE_COLOR already decide",
            ));
        }
    }
    if let Some(plain) = facts.plain {
        if facts.color.is_some() || facts.interaction.is_some() {
            return Err(syn::Error::new(
                plain,
                "a plain option takes no color or interaction mark",
            ));
        }
        if let Some(polarity) = &facts.polarity
            && polarity.value.value() != "positive"
        {
            return Err(syn::Error::new(
                polarity.key,
                "a plain option takes positive polarity",
            ));
        }
        if let Some(short) = &facts.short {
            return Err(syn::Error::new(
                short.key,
                "a plain option takes no short spelling",
            ));
        }
        if let Some(env) = &facts.env {
            return Err(syn::Error::new(
                env.key,
                "a plain option takes no environment binding",
            ));
        }
    }
    if facts.verbose.is_some() || facts.quiet.is_some() {
        if let Some(env) = &facts.env {
            return Err(syn::Error::new(
                env.key,
                "a verbose or quiet option takes no environment binding",
            ));
        }
    }
    let list = matches!(wrapper, Wrapper::List(_));
    if list && matches!(kind, Kind::StringOption | Kind::ContentOption) {
        if let (Some(env), None) = (&facts.env, &facts.env_delimiter) {
            return Err(syn::Error::new(
                env.key,
                "a multiple option's environment binding needs `env_delimiter` to split the variable's value",
            ));
        }
    }
    if let Some(omitted) = facts.validate_omitted {
        reject(
            facts.validate.is_none(),
            omitted,
            "`validate_omitted` needs `validate`, the validator that receives the omission",
        )?;
        if let Some(default) = &facts.default {
            return Err(syn::Error::new(
                default.key,
                "a validator that receives the omission answers in place of a default; drop `default`",
            ));
        }
        reject(
            list,
            omitted,
            "an omitted list is empty and calls no validator; `validate_omitted` takes a single value",
        )?;
        reject(
            matches!(wrapper, Wrapper::Optional(_)),
            omitted,
            "a validator that receives the omission always answers a value; drop the `Option`",
        )?;
    }
    if let (Some(_), Some(non_interactive)) = (facts.required, facts.non_interactive) {
        return Err(syn::Error::new(
            non_interactive,
            "a required input is required whether or not the run can ask; drop `non_interactive` or `required`",
        ));
    }
    if let (Some(_), Some(default)) = (facts.required, &facts.default) {
        return Err(syn::Error::new(
            default.key,
            "a required input takes no default; drop `default` or `required`",
        ));
    }
    if let (Some(_), Some(default)) = (facts.non_interactive, &facts.default) {
        return Err(syn::Error::new(
            default.key,
            "an input required when the run cannot ask takes no default; drop `default` or `non_interactive`",
        ));
    }
    if let Some(default) = &facts.default {
        reject(
            matches!(default.value, Expr::Array(_)) && !list && facts.arity.is_none(),
            default.key,
            "a list default fills a `Vec` field; give one value, such as `default = \"a\"`",
        )?;
    }
    if let Some(polarity) = &facts.polarity {
        reject(
            !["positive", "negative", "both"].contains(&polarity.value.value().as_str()),
            polarity.value.span(),
            "polarity is \"positive\", \"negative\", or \"both\"",
        )?;
    }
    Ok(())
}

/// The rules the field type sets on presence and counts: a non-`Option` scalar is required, an
/// `Option` is optional, and only a `Vec` collects or bounds its count.
fn reject_presence(kind: Kind, wrapper: Wrapper<'_>, facts: &FieldAttributes) -> syn::Result<()> {
    let bounds = facts
        .min
        .as_ref()
        .map(|min| min.key)
        .or(facts.max.as_ref().map(|max| max.key));
    match wrapper {
        Wrapper::Scalar(_) => {
            if let Some(required) = facts.required {
                return Err(syn::Error::new(
                    required,
                    "a field that is not an `Option` or a `Vec` is already required; drop `required`",
                ));
            }
            if let Some(non_interactive) = facts.non_interactive {
                return Err(syn::Error::new(
                    non_interactive,
                    "an input required only when the run cannot ask reads as `Option<T>`",
                ));
            }
            if let Some(key) = bounds {
                return Err(syn::Error::new(
                    key,
                    "`min` and `max` bound how many sources a `Vec` field collects",
                ));
            }
        }
        Wrapper::Optional(_) => {
            if let Some(required) = facts.required {
                return Err(syn::Error::new(
                    required,
                    "an `Option` field is optional; drop the `Option` to require it",
                ));
            }
            if let Some(default) = &facts.default {
                return Err(syn::Error::new(
                    default.key,
                    "a declared default makes the value present; drop the `Option`",
                ));
            }
            if let Some(key) = bounds {
                return Err(syn::Error::new(
                    key,
                    "`min` and `max` bound how many sources a `Vec` field collects",
                ));
            }
        }
        Wrapper::List(_) => {}
    }
    if matches!(kind, Kind::Stdin) && matches!(wrapper, Wrapper::List(_)) {
        return Err(syn::Error::new(
            wrapper.element().span(),
            "a #[stdin] field reads one stdin: `Content` or `Option<Content>`",
        ));
    }
    Ok(())
}

/// The env fact: a string literal is one variable; anything else is a list expression.
fn env_list(expression: &Expr) -> TokenStream {
    match expression {
        Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Str(_),
            ..
        }) => quote!([#expression]),
        _ => quote!(#expression),
    }
}

/// The setters every option kind shares.
fn shared_option_setters(facts: &FieldAttributes, description: Option<&LitStr>) -> TokenStream {
    let mut calls = TokenStream::new();
    if let Some(description) = description {
        calls.extend(quote!(.description(#description)));
    }
    if let Some(short) = &facts.short {
        let short = &short.value;
        calls.extend(quote!(.short(#short)));
    }
    if facts.short_only.is_some() {
        calls.extend(quote!(.short_only()));
    }
    if let Some(aliases) = &facts.aliases {
        let aliases = &aliases.value;
        calls.extend(quote!(.aliases(#aliases)));
    }
    if facts.hidden.is_some() {
        calls.extend(quote!(.hidden()));
    }
    if let Some(message) = &facts.deprecated {
        let message = &message.value;
        calls.extend(quote!(.deprecated(#message)));
    }
    if facts.control.is_some() {
        calls.extend(quote!(.control()));
    }
    if let Some(env) = &facts.env {
        let list = env_list(&env.value);
        calls.extend(quote!(.env(#list)));
    }
    if let Some(extensions) = &facts.extensions {
        let extensions = &extensions.value;
        calls.extend(quote!(.extend(#extensions)));
    }
    calls
}

/// One field's declaration call, its extraction, its write back into values, and what it says
/// about the struct.
struct Expanded {
    declare: TokenStream,
    extract: TokenStream,
    insert: TokenStream,
    global: bool,
}

/// The write of one field into `InputValues`, the inverse of its extraction: a scalar that is not a
/// flag or a count is a value validation guarantees, so it is written as `Required`.
fn insert_field(field: &Field, kind: Kind, wrapper: Wrapper<'_>, name: &LitStr) -> TokenStream {
    let ident = &field.ident;
    let scalar = matches!(wrapper, Wrapper::Scalar(_));
    match kind {
        Kind::Stdin if scalar => {
            quote!(let values = values.with_stdin(::core::option::Option::Some(self.#ident));)
        }
        Kind::Stdin => quote!(let values = values.with_stdin(self.#ident);),
        Kind::Passthrough => quote!(let values = values.with_passthrough(self.#ident);),
        Kind::BooleanOption | Kind::CountOption => {
            quote!(let values = values.with_option(#name, self.#ident);)
        }
        Kind::StringOption | Kind::ContentOption if scalar => {
            quote!(let values = values.with_option(#name, ::loomcli_core::Required(self.#ident));)
        }
        Kind::StringOption | Kind::ContentOption => {
            quote!(let values = values.with_option(#name, self.#ident);)
        }
        Kind::StringArgument | Kind::ContentArgument if scalar => {
            quote!(let values = values.with_argument(#name, ::loomcli_core::Required(self.#ident));)
        }
        Kind::StringArgument | Kind::ContentArgument => {
            quote!(let values = values.with_argument(#name, self.#ident);)
        }
    }
}

fn arity_of<'a>(
    wrapper: Wrapper<'a>,
    facts: &FieldAttributes,
) -> syn::Result<Option<&'a syn::TypeArray>> {
    let Some(flag) = facts.arity else {
        return Ok(None);
    };
    let Type::Array(array) = wrapper.element() else {
        return Err(syn::Error::new(
            flag,
            "`arity` needs an array field: `[T; N]`, `Option<[T; N]>`, or `Vec<[T; N]>`",
        ));
    };
    let multiple = matches!(wrapper, Wrapper::List(_));
    for (key, setting) in [
        (facts.implied.as_ref().map(|fact| fact.key), "implied"),
        (facts.validate_omitted, "validate_omitted"),
        (facts.env_allow_empty, "env_allow_empty"),
        (facts.background, "background"),
    ] {
        if let Some(key) = key {
            return Err(syn::Error::new(
                key,
                format!("`{setting}` does not apply to an arity option"),
            ));
        }
    }
    if let Some(env) = &facts.env {
        reject(
            multiple,
            env.key,
            "a multiple arity option takes no environment binding",
        )?;
        reject(
            facts.env_delimiter.is_none(),
            env.key,
            "an arity option's environment binding needs `env_delimiter`",
        )?;
    }
    let count = if let Expr::Lit(literal) = &array.len
        && let syn::Lit::Int(count) = &literal.lit
    {
        let value = count.base10_parse::<usize>()?;
        reject(
            value < 2,
            count.span(),
            "an arity option takes at least two words",
        )?;
        Some(value)
    } else {
        None
    };
    if let Some(default) = &facts.default {
        reject(
            matches!(default.value, Expr::Lit(_)),
            default.key,
            "an arity option takes an array default, or an array of arrays for a multiple option",
        )?;
        if let Expr::Array(items) = &default.value {
            if multiple {
                for item in &items.elems {
                    if let Expr::Array(words) = item {
                        reject(
                            count.is_some_and(|count| words.elems.len() != count),
                            item.span(),
                            "each default occurrence must have exactly the declared arity",
                        )?;
                    } else if matches!(item, Expr::Lit(_)) {
                        return Err(syn::Error::new(
                            item.span(),
                            "each default occurrence must be an array of words",
                        ));
                    }
                }
            } else {
                reject(
                    count.is_some_and(|count| items.elems.len() != count),
                    default.key,
                    "the default must have exactly the declared arity",
                )?;
            }
        }
    }
    Ok(Some(array))
}

fn expand_field(field: &Field) -> syn::Result<Expanded> {
    let (role, facts) = parse_field(field)?;
    let wrapper = Wrapper::of(&field.ty);
    let kind = kind_of(role, wrapper, &facts)?;
    reject_foreign_facts(kind, &facts)?;
    reject_beside_builder(&facts)?;
    let arity = arity_of(wrapper, &facts)?;
    reject_presence(kind, wrapper, &facts)?;
    reject_fact_pairs(kind, wrapper, &facts)?;
    let name = declared_name(field, &facts)?;
    if !matches!(kind, Kind::Stdin | Kind::Passthrough) {
        reject_declared_names(&name, &facts)?;
    }
    // A shared builder carries its own description; the field's doc comment documents the field.
    let description = facts
        .description
        .as_ref()
        .map(|description| description.value.clone())
        .or_else(|| {
            facts
                .builder
                .is_none()
                .then(|| doc_description(field))
                .flatten()
        });
    let mut expanded = match kind {
        Kind::Stdin => expand_stdin(wrapper, description.as_ref()),
        Kind::Passthrough => expand_passthrough(description.as_ref()),
        Kind::BooleanOption => expand_boolean(&facts, &name, description.as_ref()),
        Kind::CountOption => expand_count(&facts, wrapper, &name, description.as_ref())?,
        Kind::ContentOption => expand_content_option(&facts, wrapper, &name, description.as_ref()),
        Kind::StringOption => {
            expand_string_option(&facts, wrapper, arity, &name, description.as_ref())
        }
        Kind::StringArgument | Kind::ContentArgument => {
            expand_argument(&facts, kind, wrapper, &name, description.as_ref())
        }
    };
    expanded.insert = if arity.is_some() {
        let ident = &field.ident;
        let vector = quote!(::std::vec::Vec::from);
        let value = match wrapper {
            Wrapper::Scalar(_) => quote!(::loomcli_core::Required(#vector(self.#ident))),
            Wrapper::Optional(_) => quote!(self.#ident.map(#vector)),
            Wrapper::List(_) => {
                quote!(self.#ident.into_iter().map(#vector).collect::<::std::vec::Vec<_>>())
            }
        };
        quote!(let values = values.with_option(#name, #value);)
    } else {
        insert_field(field, kind, wrapper, &name)
    };
    Ok(expanded)
}

fn expand_passthrough(description: Option<&LitStr>) -> Expanded {
    let mut mode = quote!(::loomcli_core::Passthrough::new());
    if let Some(description) = description {
        mode.extend(quote!(.description(#description)));
    }
    Expanded {
        declare: quote!(let declarations = declarations.passthrough(#mode);),
        extract: quote!(values.passthrough().to_vec()),
        insert: quote!(),
        global: false,
    }
}

fn expand_stdin(wrapper: Wrapper<'_>, description: Option<&LitStr>) -> Expanded {
    let mut stdin = quote!(::loomcli_core::Stdin::new());
    if let Some(description) = description {
        stdin.extend(quote!(.description(#description)));
    }
    let extract = if matches!(wrapper, Wrapper::Scalar(_)) {
        stdin.extend(quote!(.required()));
        quote!(values.required_stdin()?)
    } else {
        quote!(values.stdin())
    };
    Expanded {
        declare: quote!(let declarations = declarations.stdin(#stdin);),
        extract,
        insert: quote!(),
        global: false,
    }
}

fn expand_boolean(
    facts: &FieldAttributes,
    name: &LitStr,
    description: Option<&LitStr>,
) -> Expanded {
    let mut builder = quote!(::loomcli_core::Opt::boolean());
    builder.extend(shared_option_setters(facts, description));
    if let Some(polarity) = &facts.polarity {
        let variant = match polarity.value.value().as_str() {
            "negative" => quote!(Negative),
            "both" => quote!(Both),
            _ => quote!(Positive),
        };
        builder.extend(quote!(.polarity(::loomcli_core::Polarity::#variant)));
    }
    if facts.interaction.is_some() {
        builder.extend(quote!(.interaction()));
    }
    if facts.color.is_some() {
        builder.extend(quote!(.color()));
    }
    if facts.plain.is_some() {
        builder.extend(quote!(.plain()));
    }
    Expanded {
        declare: quote!(let declarations = declarations.option(#name, #builder);),
        extract: quote!(values.option::<bool>(#name)?),
        insert: quote!(),
        global: true,
    }
}

fn expand_count(
    facts: &FieldAttributes,
    wrapper: Wrapper<'_>,
    name: &LitStr,
    description: Option<&LitStr>,
) -> syn::Result<Expanded> {
    let element = wrapper.element();
    let integer = last_ident(element).is_some_and(|ident| COUNT_TYPES.contains(&ident.as_str()));
    if !matches!(wrapper, Wrapper::Scalar(_)) || !integer {
        return Err(syn::Error::new(
            element.span(),
            "a counted option's field is an unsigned integer: u8, u16, u32, u64, or usize",
        ));
    }
    let mut builder = quote!(::loomcli_core::Opt::count());
    builder.extend(shared_option_setters(facts, description));
    if facts.verbose.is_some() {
        builder.extend(quote!(.verbose()));
    }
    if facts.quiet.is_some() {
        builder.extend(quote!(.quiet()));
    }
    Ok(Expanded {
        declare: quote!(let declarations = declarations.option(#name, #builder);),
        extract: quote!(values.option::<#element>(#name)?),
        insert: quote!(),
        global: true,
    })
}

fn expand_content_option(
    facts: &FieldAttributes,
    wrapper: Wrapper<'_>,
    name: &LitStr,
    description: Option<&LitStr>,
) -> Expanded {
    let mut builder = match &facts.builder {
        // A shared builder, such as a document input several Commands declare, holds every option
        // fact, so `reject_beside_builder` admits only the name and the `Vec` presence facts beside
        // it: the type still decides presence and multiplicity below.
        Some(shared) => {
            let shared = &shared.value;
            quote!((#shared))
        }
        None => {
            let mut builder = quote!(::loomcli_core::Opt::content());
            builder.extend(shared_option_setters(facts, description));
            if facts.stdin.is_some() {
                builder.extend(quote!(.stdin()));
            }
            if let Some(delimiter) = &facts.env_delimiter {
                let delimiter = &delimiter.value;
                builder.extend(quote!(.env_delimiter(#delimiter)));
            }
            builder
        }
    };
    let extract = match wrapper {
        Wrapper::Scalar(element) => {
            builder.extend(quote!(.required()));
            quote!(values.required_option::<#element>(#name)?)
        }
        Wrapper::Optional(element) => {
            quote!(values.option::<::core::option::Option<#element>>(#name)?)
        }
        Wrapper::List(element) => {
            builder.extend(quote!(.multiple()));
            if facts.required.is_some() {
                builder.extend(quote!(.required()));
            }
            if let Some(min) = &facts.min {
                let min = &min.value;
                builder.extend(quote!(.min(#min)));
            }
            if let Some(max) = &facts.max {
                let max = &max.value;
                builder.extend(quote!(.max(#max)));
            }
            quote!(values.option::<::std::vec::Vec<#element>>(#name)?)
        }
    };
    Expanded {
        declare: quote!(let declarations = declarations.option(#name, #builder);),
        extract,
        insert: quote!(),
        global: false,
    }
}

/// The validator call and its compile-time output check, for a string input.
fn validation(facts: &FieldAttributes, element: &Type) -> (TokenStream, TokenStream) {
    match &facts.validate {
        Some(validator) => {
            let validator = &validator.value;
            let setter = if facts.validate_omitted.is_some() {
                quote!(validate_omitted)
            } else {
                quote!(validate)
            };
            let assertion = quote_spanned! {element.span()=>
                ::loomcli_core::assert_validator_output::<#element, _>(&validator);
            };
            (
                quote! {
                    let validator = #validator;
                    #assertion
                },
                quote!(.#setter(validator)),
            )
        }
        None => (
            quote_spanned! {element.span()=>
                ::loomcli_core::assert_string_input::<#element>();
            },
            quote!(),
        ),
    }
}

fn expand_string_option(
    facts: &FieldAttributes,
    wrapper: Wrapper<'_>,
    arity: Option<&syn::TypeArray>,
    name: &LitStr,
    description: Option<&LitStr>,
) -> Expanded {
    let element = arity.map_or_else(|| wrapper.element(), |array| array.elem.as_ref());
    let (prelude, validate) = validation(facts, element);
    let mut builder = quote!(::loomcli_core::Opt::string());
    builder.extend(shared_option_setters(facts, description));
    builder.extend(validate);
    if let Some(array) = arity {
        let count = &array.len;
        builder.extend(quote!(.arity(#count)));
    }
    if let Some(default) = &facts.default {
        let default = &default.value;
        if matches!(wrapper, Wrapper::List(_))
            && let Some(array) = arity
            && let Expr::Array(items) = default
            && items.elems.is_empty()
        {
            let count = &array.len;
            builder.extend(quote!(.default([] as [[&str; #count]; 0])));
        } else {
            builder.extend(quote!(.default(#default)));
        }
    }
    if facts.last_wins.is_some() {
        builder.extend(quote!(.last_wins()));
    }
    if let Some(implied) = &facts.implied {
        let implied = &implied.value;
        builder.extend(quote!(.implied(#implied)));
    }
    if let Some(delimiter) = &facts.env_delimiter {
        let delimiter = &delimiter.value;
        builder.extend(quote!(.env_delimiter(#delimiter)));
    }
    if facts.env_allow_empty.is_some() {
        builder.extend(quote!(.env_allow_empty()));
    }
    if facts.background.is_some() {
        builder.extend(quote!(.background()));
    }
    let read_type = if arity.is_some() {
        quote!(::std::vec::Vec<#element>)
    } else {
        quote!(#element)
    };
    let (extract, global) = match wrapper {
        Wrapper::Scalar(_) => {
            let present = facts.default.is_some() || facts.validate_omitted.is_some();
            if !present {
                builder.extend(quote!(.required()));
            }
            (
                quote!(values.required_option::<#read_type>(#name)?),
                facts.default.is_some(),
            )
        }
        Wrapper::Optional(_) => {
            if facts.non_interactive.is_some() {
                builder.extend(quote!(.required_when_non_interactive()));
            }
            (
                quote!(values.option::<::core::option::Option<#read_type>>(#name)?),
                facts.non_interactive.is_none(),
            )
        }
        Wrapper::List(_) => {
            builder.extend(quote!(.multiple()));
            if facts.required.is_some() {
                builder.extend(quote!(.required()));
            }
            if facts.non_interactive.is_some() {
                builder.extend(quote!(.required_when_non_interactive()));
            }
            (
                quote!(values.option::<::std::vec::Vec<#read_type>>(#name)?),
                facts.required.is_none() && facts.non_interactive.is_none(),
            )
        }
    };
    let extract = if let Some(array) = arity {
        let count = &array.len;
        let array = quote!(|words| ::loomcli_core::__private::arity_array::<#element, { #count }>(#name, words));
        match wrapper {
            Wrapper::Scalar(_) => quote!((#array)(#extract)?),
            Wrapper::Optional(_) => quote!((#extract).map(#array).transpose()?),
            Wrapper::List(_) => {
                quote!((#extract).into_iter().map(#array).collect::<::core::result::Result<::std::vec::Vec<_>, _>>()?)
            }
        }
    } else {
        extract
    };
    Expanded {
        declare: quote! {
            let declarations = {
                #prelude
                declarations.option(#name, #builder)
            };
        },
        extract,
        insert: quote!(),
        global,
    }
}

fn expand_argument(
    facts: &FieldAttributes,
    kind: Kind,
    wrapper: Wrapper<'_>,
    name: &LitStr,
    description: Option<&LitStr>,
) -> Expanded {
    let content = kind == Kind::ContentArgument;
    let mut builder = if content {
        quote!(::loomcli_core::Arg::content())
    } else {
        quote!(::loomcli_core::Arg::string())
    };
    if let Some(description) = description {
        builder.extend(quote!(.description(#description)));
    }
    let mut prelude = quote!();
    if content {
        if facts.stdin.is_some() {
            builder.extend(quote!(.stdin()));
        }
    } else {
        let (checks, validate) = validation(facts, wrapper.element());
        prelude = checks;
        builder.extend(validate);
        if let Some(default) = &facts.default {
            let default = &default.value;
            builder.extend(quote!(.default(#default)));
        }
    }
    let extract = match wrapper {
        Wrapper::Scalar(element) => {
            if facts.default.is_none() && facts.validate_omitted.is_none() {
                builder.extend(quote!(.required()));
            }
            quote!(values.required_argument::<#element>(#name)?)
        }
        Wrapper::Optional(element) => {
            if facts.non_interactive.is_some() {
                builder.extend(quote!(.required_when_non_interactive()));
            }
            quote!(values.argument::<::core::option::Option<#element>>(#name)?)
        }
        Wrapper::List(element) => {
            builder.extend(quote!(.variadic()));
            if facts.required.is_some() {
                builder.extend(quote!(.required()));
            }
            if facts.non_interactive.is_some() {
                builder.extend(quote!(.required_when_non_interactive()));
            }
            if let Some(min) = &facts.min {
                let min = &min.value;
                builder.extend(quote!(.min(#min)));
            }
            if let Some(max) = &facts.max {
                let max = &max.value;
                builder.extend(quote!(.max(#max)));
            }
            quote!(values.argument::<::std::vec::Vec<#element>>(#name)?)
        }
    };
    if let Some(extensions) = &facts.extensions {
        let extensions = &extensions.value;
        builder.extend(quote!(.extend(#extensions)));
    }
    Expanded {
        declare: quote! {
            let declarations = {
                #prelude
                declarations.argument(#name, #builder)
            };
        },
        extract,
        insert: quote!(),
        global: false,
    }
}

/// The option groups a struct-level `#[inputs(...)]` declares, and whether it declares any. A
/// member names a declared name; one that is a field's identifier where the field declares another
/// name is a compile error at the member. `names` holds each field's identifier and declared name.
fn struct_groups(
    input: &DeriveInput,
    names: &[(String, String)],
) -> syn::Result<(TokenStream, bool)> {
    let mut calls = TokenStream::new();
    let mut any = false;
    for attribute in &input.attrs {
        if !attribute.path().is_ident("inputs") {
            continue;
        }
        attribute.parse_nested_meta(|meta| {
            let method = if meta.path.is_ident("exclusive") {
                quote!(exclusive)
            } else if meta.path.is_ident("one_required") {
                quote!(one_required)
            } else if meta.path.is_ident("required_together") {
                quote!(required_together)
            } else {
                return Err(
                    meta.error("expected `exclusive`, `one_required`, or `required_together`")
                );
            };
            let content;
            syn::parenthesized!(content in meta.input);
            let members = parse_names(&content)?;
            for member in &members {
                let text = member.value();
                let declared = names.iter().any(|(_, declared)| *declared == text);
                if let Some((_, declared)) = names
                    .iter()
                    .find(|(ident, _)| *ident == text)
                    .filter(|_| !declared)
                {
                    return Err(syn::Error::new(
                        member.span(),
                        format!(
                            "`{text}` is the field; a group names the declared name {declared:?}"
                        ),
                    ));
                }
            }
            calls.extend(quote!(let declarations = declarations.#method(&[#(#members),*]);));
            any = true;
            Ok(())
        })?;
    }
    Ok((calls, any))
}

fn parse_names(input: ParseStream<'_>) -> syn::Result<Vec<LitStr>> {
    let names = input.parse_terminated(
        |stream: ParseStream<'_>| stream.parse::<LitStr>(),
        syn::Token![,],
    )?;
    Ok(names.into_iter().collect())
}

pub(crate) fn expand(input: &DeriveInput) -> syn::Result<TokenStream> {
    let name = &input.ident;
    let (impl_generics, type_generics, where_clause) = input.generics.split_for_impl();
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            name,
            "#[derive(Inputs)] applies to a struct whose fields are inputs",
        ));
    };
    let fields: Vec<&Field> = match &data.fields {
        Fields::Named(fields) => fields.named.iter().collect(),
        Fields::Unit => Vec::new(),
        Fields::Unnamed(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(Inputs)] reads each field by its name, so the struct has named fields",
            ));
        }
    };
    let mut declares = Vec::new();
    let mut extracts = Vec::new();
    let mut inserts = Vec::new();
    let mut global = true;
    let mut errors: Option<syn::Error> = None;
    let mut names = Vec::new();
    for field in &fields {
        if let (Some(ident), Ok((_, facts))) = (&field.ident, parse_field(field))
            && let Ok(declared) = declared_name(field, &facts)
        {
            let ident = ident.to_string();
            let ident = ident.strip_prefix("r#").unwrap_or(&ident).to_owned();
            names.push((ident, declared.value()));
        }
        match expand_field(field) {
            Ok(expanded) => {
                declares.push(expanded.declare);
                inserts.push(expanded.insert);
                let ident = &field.ident;
                let extract = expanded.extract;
                extracts.push(quote!(#ident: #extract));
                global &= expanded.global;
            }
            // Every field's fault is reported at once, each at its own span.
            Err(error) => match &mut errors {
                Some(errors) => errors.combine(error),
                None => errors = Some(error),
            },
        }
    }
    if let Some(errors) = errors {
        return Err(errors);
    }
    let (groups, grouped) = struct_groups(input, &names)?;
    // A group is a Command's rule, never a global option's.
    let global = global && !grouped;
    let construct = match &data.fields {
        Fields::Unit => quote!(#name),
        _ => quote!(#name { #(#extracts),* }),
    };
    let global_impl = if global {
        quote! {
            impl #impl_generics ::loomcli_core::GlobalInputs for #name #type_generics #where_clause {}
        }
    } else {
        quote!()
    };
    Ok(quote! {
        #global_impl

        impl #impl_generics ::loomcli_core::Inputs for #name #type_generics #where_clause {
            fn declare(declarations: ::loomcli_core::Declarations) -> ::loomcli_core::Declarations {
                #(#declares)*
                #groups
                declarations
            }

            fn extract(
                values: &::loomcli_core::InputValues,
            ) -> ::core::result::Result<Self, ::loomcli_core::Error> {
                let _ = values;
                ::core::result::Result::Ok(#construct)
            }

            fn into_values(self) -> ::loomcli_core::InputValues {
                let values = ::loomcli_core::InputValues::new();
                #(#inserts)*
                values
            }
        }
    })
}

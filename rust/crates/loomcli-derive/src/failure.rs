//! The `#[derive(Failure)]` expansion.

use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Expr, Fields, LitStr};

struct ClassAttributes {
    code: Option<LitStr>,
    exit_code: Option<Expr>,
    is_abstract: bool,
}

/// Whether `code` is a failure code: lowercase words of letters and digits joined by single hyphens,
/// the grammar `loomcli_core::is_failure_code` states, checked here to fault at the literal.
fn is_failure_code(code: &str) -> bool {
    !code.is_empty()
        && code.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

/// An exit code written as an integer literal, checked against the range a failure class declares.
fn literal_exit_code(expression: &Expr) -> syn::Result<Option<TokenStream>> {
    let (negative, literal) = match expression {
        Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Int(literal),
            ..
        }) => (false, literal),
        Expr::Unary(syn::ExprUnary {
            op: syn::UnOp::Neg(_),
            expr,
            ..
        }) => match &**expr {
            Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Int(literal),
                ..
            }) => (true, literal),
            _ => return Ok(None),
        },
        _ => return Ok(None),
    };
    let value = literal.base10_parse::<u64>().ok();
    match value {
        Some(value @ 1..=125) if !negative => {
            let value = u8::try_from(value).unwrap_or(1);
            Ok(Some(quote!(::loomcli_core::FailureExitCode::new(#value))))
        }
        _ => Err(syn::Error::new_spanned(
            expression,
            "a failure class declares an exit code from 1 through 125, such as `EX_DATAERR` or `65`",
        )),
    }
}

fn class_attributes(input: &DeriveInput) -> syn::Result<ClassAttributes> {
    let mut attributes = ClassAttributes {
        code: None,
        exit_code: None,
        is_abstract: false,
    };
    for attribute in &input.attrs {
        if !attribute.path().is_ident("failure") {
            continue;
        }
        attribute.parse_nested_meta(|meta| {
            let twice = |key: &str| meta.error(format!("`{key}` is declared twice"));
            if meta.path.is_ident("code") {
                if attributes.code.is_some() {
                    return Err(twice("code"));
                }
                let code: LitStr = meta.value()?.parse()?;
                if !is_failure_code(&code.value()) {
                    return Err(syn::Error::new_spanned(
                        &code,
                        "a failure code is lowercase words of letters and digits joined by single hyphens, such as \"path-not-found\"",
                    ));
                }
                attributes.code = Some(code);
            } else if meta.path.is_ident("exit_code") {
                if attributes.exit_code.is_some() {
                    return Err(twice("exit_code"));
                }
                attributes.exit_code = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("abstract") {
                if attributes.is_abstract {
                    return Err(twice("abstract"));
                }
                attributes.is_abstract = true;
            } else if meta.path.is_ident("base") {
                return Err(meta.error(
                    "`base` marks the field that holds the parent class's value, not the struct",
                ));
            } else {
                return Err(meta.error("expected `code`, `exit_code`, or `abstract`"));
            }
            Ok(())
        })?;
    }
    Ok(attributes)
}

pub(crate) fn expand(input: &DeriveInput) -> syn::Result<TokenStream> {
    let name = &input.ident;
    if !input.generics.params.is_empty() {
        return Err(syn::Error::new_spanned(
            &input.generics,
            "a failure class has one static class value, so it takes no generic parameters",
        ));
    }
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            name,
            "#[derive(Failure)] applies to a struct with named fields, one of them the `#[failure(base)]` parent",
        ));
    };
    let Fields::Named(fields) = &data.fields else {
        return Err(syn::Error::new_spanned(
            name,
            "#[derive(Failure)] applies to a struct with named fields, one of them the `#[failure(base)]` parent",
        ));
    };
    let attributes = class_attributes(input)?;
    let mut base = None;
    for field in &fields.named {
        for attribute in &field.attrs {
            if !attribute.path().is_ident("failure") {
                continue;
            }
            attribute.parse_nested_meta(|meta| {
                if meta.path.is_ident("base") {
                    if base.is_some() {
                        return Err(meta.error("a failure class has one `#[failure(base)]` field"));
                    }
                    base = Some(field);
                    Ok(())
                } else {
                    Err(meta.error(
                        "a field's failure attribute is `#[failure(base)]`, on the field that holds the parent class's value",
                    ))
                }
            })?;
        }
    }
    let Some(base) = base else {
        return Err(syn::Error::new_spanned(
            name,
            "a failure class holds its parent class's value in a `#[failure(base)]` field, such as `base: FatalError`",
        ));
    };
    let base_name = &base.ident;
    let base_type = &base.ty;
    let class_name = LitStr::new(&name.to_string(), name.span());
    let code = match &attributes.code {
        Some(code) => quote!(::core::option::Option::Some(#code)),
        None => quote!(::core::option::Option::None),
    };
    let exit_code = match &attributes.exit_code {
        Some(expression) => match literal_exit_code(expression)? {
            Some(code) => quote!(::core::option::Option::Some(#code)),
            None => quote!(::core::option::Option::Some(#expression)),
        },
        None => quote!(::core::option::Option::None),
    };
    let conversion = if attributes.is_abstract {
        quote!()
    } else {
        quote! {
            impl ::core::convert::From<#name> for ::loomcli_core::Error {
                fn from(failure: #name) -> Self {
                    ::loomcli_core::Error::from_failure(failure)
                }
            }
        }
    };
    Ok(quote! {
        impl ::loomcli_core::Failure for #name {
            fn class(&self) -> &'static ::loomcli_core::FailureClass {
                <Self as ::loomcli_core::Failure>::failure_class()
            }

            fn failure_class() -> &'static ::loomcli_core::FailureClass {
                static CLASS: ::loomcli_core::FailureClass = ::loomcli_core::FailureClass::new(
                    #class_name,
                    #code,
                    #exit_code,
                    ::core::option::Option::Some(
                        <#base_type as ::loomcli_core::Failure>::failure_class
                            as fn() -> &'static ::loomcli_core::FailureClass,
                    ),
                );
                &CLASS
            }

            fn base(&self) -> ::core::option::Option<&dyn ::loomcli_core::Failure> {
                ::core::option::Option::Some(&self.#base_name)
            }

            fn as_any(&self) -> &dyn ::core::any::Any {
                self
            }
        }

        #conversion
    })
}

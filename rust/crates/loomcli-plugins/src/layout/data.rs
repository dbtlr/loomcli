//! A row or an item read into JSON data without losing what its author returned. `serde_json`
//! widens an `f32` to the double nearest it (`0.1f32` reads `0.10000000149011612`), turns `NaN`
//! and either infinity into `null`, and fails on a 128-bit integer outside the 64-bit range. The
//! views read data through an adapter that sits between a type's `Serialize` and `serde_json`'s
//! value serializer instead, at every depth: an `f32` arrives as the double its shortest digits
//! name, a 128-bit integer outside the 64-bit range as its exact digits, and, for the default text
//! only, a non-finite number as the name `String(value)` gives it (`NaN`, `Infinity`,
//! `-Infinity`).

use serde::ser::{
    Serialize, SerializeMap, SerializeSeq, SerializeStruct, SerializeStructVariant, SerializeTuple,
    SerializeTupleStruct, SerializeTupleVariant, Serializer,
};
use serde_json::Value;

/// What the data is read for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reading {
    /// The value a `format` callback receives: a non-finite number is `null`, as JSON has it.
    Value,
    /// The value a default cell, value, or item prints: a non-finite number is its name.
    Text,
}

/// A value's data as a `format` callback receives it, and its keys as the views discover them.
pub(crate) fn data_value<T: Serialize + ?Sized>(value: &T) -> Result<Value, serde_json::Error> {
    serde_json::to_value(Faithful(value, Reading::Value))
}

/// A value's data as its default text reads it: [`data_value`] with `NaN`, `Infinity`, and
/// `-Infinity` kept as those names, the way `String(value)` prints them, inside an array too.
pub(crate) fn text_value<T: Serialize + ?Sized>(value: &T) -> Result<Value, serde_json::Error> {
    serde_json::to_value(Faithful(value, Reading::Text))
}

/// A value serialized through the [`Adapter`], so its members are too.
struct Faithful<'a, T: ?Sized>(&'a T, Reading);

impl<T: Serialize + ?Sized> Serialize for Faithful<'_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(Adapter {
            inner: serializer,
            reading: self.1,
        })
    }
}

/// A serializer that hands everything to `inner` but the numbers JSON cannot hold as written.
struct Adapter<S> {
    inner: S,
    reading: Reading,
}

/// A compound serializer whose members go through the [`Adapter`] in turn.
struct Members<C> {
    inner: C,
    reading: Reading,
}

/// The name `String(value)` gives a number that is not finite.
fn non_finite_name(value: f64) -> &'static str {
    if value.is_nan() {
        "NaN"
    } else if value > 0.0 {
        "Infinity"
    } else {
        "-Infinity"
    }
}

impl<S: Serializer> Serializer for Adapter<S> {
    type Ok = S::Ok;
    type Error = S::Error;
    type SerializeSeq = Members<S::SerializeSeq>;
    type SerializeTuple = Members<S::SerializeTuple>;
    type SerializeTupleStruct = Members<S::SerializeTupleStruct>;
    type SerializeTupleVariant = Members<S::SerializeTupleVariant>;
    type SerializeMap = Members<S::SerializeMap>;
    type SerializeStruct = Members<S::SerializeStruct>;
    type SerializeStructVariant = Members<S::SerializeStructVariant>;

    fn serialize_bool(self, v: bool) -> Result<S::Ok, S::Error> {
        self.inner.serialize_bool(v)
    }
    fn serialize_i8(self, v: i8) -> Result<S::Ok, S::Error> {
        self.inner.serialize_i8(v)
    }
    fn serialize_i16(self, v: i16) -> Result<S::Ok, S::Error> {
        self.inner.serialize_i16(v)
    }
    fn serialize_i32(self, v: i32) -> Result<S::Ok, S::Error> {
        self.inner.serialize_i32(v)
    }
    fn serialize_i64(self, v: i64) -> Result<S::Ok, S::Error> {
        self.inner.serialize_i64(v)
    }
    fn serialize_i128(self, v: i128) -> Result<S::Ok, S::Error> {
        if let Ok(small) = i64::try_from(v) {
            self.inner.serialize_i64(small)
        } else if let Ok(small) = u64::try_from(v) {
            self.inner.serialize_u64(small)
        } else {
            self.inner.serialize_str(&v.to_string())
        }
    }
    fn serialize_u8(self, v: u8) -> Result<S::Ok, S::Error> {
        self.inner.serialize_u8(v)
    }
    fn serialize_u16(self, v: u16) -> Result<S::Ok, S::Error> {
        self.inner.serialize_u16(v)
    }
    fn serialize_u32(self, v: u32) -> Result<S::Ok, S::Error> {
        self.inner.serialize_u32(v)
    }
    fn serialize_u64(self, v: u64) -> Result<S::Ok, S::Error> {
        self.inner.serialize_u64(v)
    }
    fn serialize_u128(self, v: u128) -> Result<S::Ok, S::Error> {
        match u64::try_from(v) {
            Ok(small) => self.inner.serialize_u64(small),
            Err(_) => self.inner.serialize_str(&v.to_string()),
        }
    }
    fn serialize_f32(self, v: f32) -> Result<S::Ok, S::Error> {
        // An f32's shortest digits name exactly one double, which prints those digits again.
        let shortest = v
            .to_string()
            .parse::<f64>()
            .unwrap_or_else(|_| f64::from(v));
        self.serialize_f64(shortest)
    }
    fn serialize_f64(self, v: f64) -> Result<S::Ok, S::Error> {
        if v.is_finite() || self.reading == Reading::Value {
            self.inner.serialize_f64(v)
        } else {
            self.inner.serialize_str(non_finite_name(v))
        }
    }
    fn serialize_char(self, v: char) -> Result<S::Ok, S::Error> {
        self.inner.serialize_char(v)
    }
    fn serialize_str(self, v: &str) -> Result<S::Ok, S::Error> {
        self.inner.serialize_str(v)
    }
    fn serialize_bytes(self, v: &[u8]) -> Result<S::Ok, S::Error> {
        self.inner.serialize_bytes(v)
    }
    fn serialize_none(self) -> Result<S::Ok, S::Error> {
        self.inner.serialize_none()
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<S::Ok, S::Error> {
        self.inner.serialize_some(&Faithful(value, self.reading))
    }
    fn serialize_unit(self) -> Result<S::Ok, S::Error> {
        self.inner.serialize_unit()
    }
    fn serialize_unit_struct(self, name: &'static str) -> Result<S::Ok, S::Error> {
        self.inner.serialize_unit_struct(name)
    }
    fn serialize_unit_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
    ) -> Result<S::Ok, S::Error> {
        self.inner.serialize_unit_variant(name, index, variant)
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.inner
            .serialize_newtype_struct(name, &Faithful(value, self.reading))
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.inner
            .serialize_newtype_variant(name, index, variant, &Faithful(value, self.reading))
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<Self::SerializeSeq, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self.inner.serialize_seq(len)?,
            reading,
        })
    }
    fn serialize_tuple(self, len: usize) -> Result<Self::SerializeTuple, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self.inner.serialize_tuple(len)?,
            reading,
        })
    }
    fn serialize_tuple_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleStruct, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self.inner.serialize_tuple_struct(name, len)?,
            reading,
        })
    }
    fn serialize_tuple_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleVariant, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self
                .inner
                .serialize_tuple_variant(name, index, variant, len)?,
            reading,
        })
    }
    fn serialize_map(self, len: Option<usize>) -> Result<Self::SerializeMap, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self.inner.serialize_map(len)?,
            reading,
        })
    }
    fn serialize_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStruct, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self.inner.serialize_struct(name, len)?,
            reading,
        })
    }
    fn serialize_struct_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStructVariant, S::Error> {
        let reading = self.reading;
        Ok(Members {
            inner: self
                .inner
                .serialize_struct_variant(name, index, variant, len)?,
            reading,
        })
    }
    fn is_human_readable(&self) -> bool {
        self.inner.is_human_readable()
    }
}

impl<C: SerializeSeq> SerializeSeq for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), C::Error> {
        self.inner.serialize_element(&Faithful(value, self.reading))
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeTuple> SerializeTuple for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), C::Error> {
        self.inner.serialize_element(&Faithful(value, self.reading))
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeTupleStruct> SerializeTupleStruct for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), C::Error> {
        self.inner.serialize_field(&Faithful(value, self.reading))
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeTupleVariant> SerializeTupleVariant for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), C::Error> {
        self.inner.serialize_field(&Faithful(value, self.reading))
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeMap> SerializeMap for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), C::Error> {
        self.inner.serialize_key(&Faithful(key, self.reading))
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), C::Error> {
        self.inner.serialize_value(&Faithful(value, self.reading))
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeStruct> SerializeStruct for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), C::Error> {
        self.inner
            .serialize_field(key, &Faithful(value, self.reading))
    }
    fn skip_field(&mut self, key: &'static str) -> Result<(), C::Error> {
        self.inner.skip_field(key)
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

impl<C: SerializeStructVariant> SerializeStructVariant for Members<C> {
    type Ok = C::Ok;
    type Error = C::Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), C::Error> {
        self.inner
            .serialize_field(key, &Faithful(value, self.reading))
    }
    fn skip_field(&mut self, key: &'static str) -> Result<(), C::Error> {
        self.inner.skip_field(key)
    }
    fn end(self) -> Result<C::Ok, C::Error> {
        self.inner.end()
    }
}

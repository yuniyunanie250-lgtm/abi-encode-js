# abi-encode

ABI encoding **including the dynamic types**: `string`, `bytes` and arrays.

Static arguments all occupy 32 bytes, and a static-only encoder is a short
function. Dynamic arguments are where it gets interesting: they live in a tail
section and are referenced by an offset in the head, so the encoder needs the
entire argument list at once.

## Layout

For `f(string, uint256)`:

```
head:  [ offset to string = 32 ][ uint256 value ]
tail:  [ string length ][ string bytes, zero-padded to a word ]
```

**Offsets are measured from the start of the argument block**, not from the start
of the calldata. Getting that wrong shifts every dynamic argument by the 4-byte
selector, which produces a call that reverts with no useful error.

## Usage

```js
import { encodeCall } from "abi-encode";

encodeCall("0xa9059cbb", [
  { type: "address", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
  { type: "uint256", value: "1000000000000000000" },
]);
```

## Rules it enforces

- **Range-checks narrow and signed types.** `uint8` with `256` throws; `int8`
  with `128` throws; negatives are two's-complemented into a full word.
- **`bytes<M>` must be exactly M bytes**, and is left-aligned with zero padding.
- **`word()` refuses negatives and values above 2^256** rather than truncating.
- **Nested dynamic arrays are refused explicitly.** `string[]` inside another
  dynamic array needs per-element offsets; returning a wrong payload silently
  would be worse than an error.

## What it does not do

- **No nested dynamic types** (`string[][]`, tuples containing dynamic members).
- **No ABI JSON parsing.** Types are given directly, one per argument.
- **No decoding.** That is `abi-decode` in this collection.

## Development

```bash
npm test
```

## License

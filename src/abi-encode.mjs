/**
 * ABI encoding, including the dynamic types the decoder side leaves out.
 *
 * Static arguments all occupy 32 bytes. Dynamic ones (`string`, `bytes`, `T[]`)
 * are encoded as an offset in the head, with the actual data in a tail section,
 * which is why an encoder needs the WHOLE argument list and cannot handle one
 * argument at a time.
 *
 * Layout for `f(string,uint256[])`:
 *
 *   head: [ offset_to_string (32) ][ offset_to_array (32) ]
 *   tail: [ string length ][ string bytes padded ]
 *         [ array length ][ element 0 ][ element 1 ] ...
 *
 * Offsets are measured from the start of the argument block, not from the start
 * of the calldata, which is the single most common off-by-32.
 */

const WORD = 32n;

export function strip0x(s) {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

export function hexToBytes(input, what = "hex") {
  const s = strip0x(String(input));
  if (s.length % 2) throw new Error(`${what}: odd number of hex digits`);
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error(`${what}: non-hex character`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pad a byte array up to the next multiple of 32 with zeros. */
export function padRight(bytes) {
  const rem = bytes.length % 32;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (32 - rem));
  out.set(bytes);
  return out;
}

export function word(value) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("word() takes an unsigned value");
    if (value >= 1n << 256n) throw new Error("value does not fit in 32 bytes");
    return hexToBytes(value.toString(16).padStart(64, "0"));
  }
  throw new Error("word() takes a bigint; encode addresses with address()");
}

export function address(addr) {
  const s = strip0x(String(addr));
  if (s.length !== 40) throw new Error(`address must be 20 bytes, got ${s.length / 2}`);
  // 12 zero bytes then the 20 address bytes = exactly 32
  return hexToBytes("00".repeat(12) + s);
}

export function bool(v) {
  return word(v ? 1n : 0n);
}

function concat(arrays) {
  const total = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

/**
 * Encode a list of {type, value} arguments.
 * Supported: uint<M>, int<M>, address, bool, bytes<M>, bytes, string, T[].
 */
export function encode(args) {
  const head = [];
  const tail = [];
  let headSize = 0n;

  // dynamic args need to know their offset, which depends on the total head size
  const layout = args.map((a) => encodeArg(a));
  for (const l of layout) headSize += l.dynamic ? WORD : WORD;

  let tailOffset = headSize;
  for (const l of layout) {
    if (!l.dynamic) {
      head.push(l.bytes);
    } else {
      head.push(word(tailOffset));
      tail.push(l.bytes);
      tailOffset += BigInt(l.bytes.length);
    }
  }
  return concat([...head, ...tail]);
}

function encodeArg({ type, value }) {
  if (type === "address") return { bytes: address(value), dynamic: false };
  if (type === "bool") return { bytes: bool(value), dynamic: false };
  if (type === "bytes" || type === "string") {
    const raw = type === "string"
      ? new TextEncoder().encode(value)
      : hexToBytes(value, "bytes");
    return {
      bytes: concat([word(BigInt(raw.length)), padRight(raw)]),
      dynamic: true,
    };
  }
  if (type.endsWith("[]")) {
    const inner = type.slice(0, -2);
    if (["bytes", "string"].includes(inner) || inner.endsWith("[]")) {
      throw new Error(`nested dynamic arrays are not supported: ${type}`);
    }
    // `value: v` — the shorthand `{ type: inner, value }` would forward the whole
    // array to each element's encoder, which BigInt() then rejects
    const parts = value.map((v) => encodeArg({ type: inner, value: v }).bytes);
    return {
      bytes: concat([word(BigInt(parts.length)), ...parts]),
      dynamic: true,
    };
  }
  const m = /^bytes(\d+)$/.exec(type);
  if (m) {
    const size = Number(m[1]);
    if (size < 1 || size > 32) throw new Error(`bad width in ${type}`);
    const raw = hexToBytes(value, type);
    if (raw.length !== size) throw new Error(`${type} needs ${size} bytes, got ${raw.length}`);
    return { bytes: padRight(raw), dynamic: false };
  }
  const n = /^(u?int)(\d+)?$/.exec(type);
  if (n) {
    const bits = n[2] ? Number(n[2]) : 256;
    let v = BigInt(value);
    if (n[1] === "int") {
      const limit = 1n << BigInt(bits - 1);
      if (v < -limit || v >= limit) throw new Error(`${type} out of range: ${value}`);
      if (v < 0n) v += 1n << 256n; // two's complement into a full word
    } else {
      if (v < 0n) throw new Error(`${type} is unsigned: ${value}`);
      if (bits < 256 && v >= 1n << BigInt(bits)) throw new Error(`${type} out of range: ${value}`);
    }
    return { bytes: word(v), dynamic: false };
  }
  throw new Error(`unsupported type: ${type}`);
}

/** Encode a call: selector (hex) + arguments. */
export function encodeCall(selector, args = []) {
  const sel = hexToBytes(selector, "selector");
  if (sel.length !== 4) throw new Error(`selector must be 4 bytes, got ${sel.length}`);
  return bytesToHex(concat([sel, encode(args)]));
}

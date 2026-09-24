import { test } from "node:test";
import assert from "node:assert/strict";
import { address, bytesToHex, encode, encodeCall, hexToBytes, padRight, word } from "../src/abi-encode.mjs";

test("word rejects negatives and overflow", () => {
  assert.equal(bytesToHex(word(255n)), "0x" + "00".repeat(31) + "ff");
  assert.throws(() => word(-1n), /unsigned/);
  assert.throws(() => word(1n << 256n), /does not fit/);
});

test("address is left-padded to 32 bytes", () => {
  assert.equal(
    bytesToHex(address("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")),
    "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
  );
  assert.throws(() => address("0x1234"), /20 bytes/);
});

test("padRight rounds up to a word boundary and is a no-op when already aligned", () => {
  assert.equal(padRight(hexToBytes("0xaabb")).length, 32);
  assert.equal(padRight(new Uint8Array(32)).length, 32);
});

test("two static arguments produce exactly 64 bytes", () => {
  const out = encode([
    { type: "address", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
    { type: "uint256", value: "1000000000000000000" },
  ]);
  assert.equal(out.length, 64);
  assert.equal(
    bytesToHex(out),
    "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045"
      + "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
  );
});

test("a single string is offset 32 then length then data", () => {
  const out = encode([{ type: "string", value: "hello" }]);
  assert.equal(
    bytesToHex(out),
    "0x" + "00".repeat(31) + "20"          // offset 32
      + "00".repeat(31) + "05"             // length 5
      + "68656c6c6f" + "00".repeat(27),    // 'hello' padded
  );
});

test("a string and a uint are laid out head-then-tail", () => {
  const out = encode([
    { type: "string", value: "hello" },
    { type: "uint256", value: "1" },
  ]);
  const hex = bytesToHex(out).slice(2);
  // head is 64 bytes: offset(32) then the uint, so the tail starts at 64
  assert.equal(hex.slice(0, 64), "00".repeat(31) + "40");
  assert.equal(hex.slice(64, 128), "00".repeat(31) + "01");
  assert.equal(out.length, 64 + 32 + 32);
});

test("uint8 range is enforced", () => {
  assert.equal(bytesToHex(encode([{ type: "uint8", value: "255" }])).slice(-2), "ff");
  assert.throws(() => encode([{ type: "uint8", value: "256" }]), /out of range/);
});

test("signed values use two's complement", () => {
  assert.equal(bytesToHex(encode([{ type: "int256", value: "-1" }])), "0x" + "ff".repeat(32));
  assert.throws(() => encode([{ type: "int8", value: "128" }]), /out of range/);
});

test("fixed bytes width is enforced and left-aligned", () => {
  assert.equal(
    bytesToHex(encode([{ type: "bytes4", value: "0xa9059cbb" }])),
    "0xa9059cbb" + "00".repeat(28),
  );
  assert.throws(() => encode([{ type: "bytes4", value: "0xa9059cbb00" }]), /needs 4 bytes/);
});

test("a uint array is length-prefixed and static inside", () => {
  const out = encode([{ type: "uint256[]", value: [1n, 2n] }]);
  assert.equal(out.length, 32 + 32 + 64);
  const hex = bytesToHex(out);
  assert.equal(hex.slice(2, 66), "00".repeat(31) + "20");
  assert.equal(hex.slice(66, 130), "00".repeat(31) + "02");
});

test("nested dynamic arrays are refused explicitly", () => {
  assert.throws(() => encode([{ type: "string[]", value: ["a"] }]), /nested dynamic/);
});

test("encodeCall prefixes a real selector", () => {
  const data = encodeCall("0xa9059cbb", [
    { type: "address", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
    { type: "uint256", value: "1000000000000000000" },
  ]);
  assert.ok(data.startsWith("0xa9059cbb"));
  assert.equal((data.length - 2) / 2, 4 + 64);
  assert.throws(() => encodeCall("0xa9059c", []), /4 bytes/);
});

test("a zero-length string still occupies a word for its length", () => {
  const out = encode([{ type: "string", value: "" }]);
  assert.equal(out.length, 64);
  assert.equal(bytesToHex(out), "0x" + "00".repeat(31) + "20" + "00".repeat(32));
});

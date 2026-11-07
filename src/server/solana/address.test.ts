import { describe, expect, it } from "vitest";
import { decodePublicKey } from "./address";

describe("decodePublicKey", () => {
  it("decodes a 32-byte base58 public key", () => {
    expect(decodePublicKey("11111111111111111111111111111114")).toHaveLength(32);
  });

  it("rejects values that decode to a different length or use an invalid character", () => {
    expect(decodePublicKey("1".repeat(33))).toBeNull();
    expect(decodePublicKey("0".repeat(32))).toBeNull();
  });
});

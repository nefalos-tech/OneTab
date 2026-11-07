import { isDecimalUnits } from "../../src/contracts";
import { roomFixtures, signingPayloadFixture } from "../../src/fixtures";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
assert(isDecimalUnits("18446744073709551615"), "maximum u64 is valid");
for (const invalid of ["-1", "1.5", "01", "18446744073709551616", "", 1]) {
  assert(!isDecimalUnits(invalid), "invalid unit value must be rejected");
}
for (const room of Object.values(roomFixtures.data)) {
  assert(roomFixtures.fixture, "room data is marked fixture");
  assert(room.participants.every((p, i) => p.slot === i), "participants are ordered");
  if (room.participants.length === room.checkout.payerCount) {
    assert(room.participants.reduce((sum, p) => sum + BigInt(p.shareUnits), 0n) === BigInt(room.checkout.totalUnits), "shares sum to total");
  }
}
assert(!roomFixtures.data.declined.attempt?.canRetry, "decline remains blocking");
assert(roomFixtures.data.expired.attempt?.canRetry === true, "safely expired attempt allows retry");
assert(signingPayloadFixture.fixture, "signing payload is marked fixture");

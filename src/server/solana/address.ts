export function decodePublicKey(value: string): Uint8Array<ArrayBuffer> | null {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  const hex = number === 0n ? "" : number.toString(16).padStart(number.toString(16).length + number.toString(16).length % 2, "0");
  const tail = hex.length === 0 ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  if (leadingZeros + tail.length !== 32) return null;
  const decoded = new Uint8Array(32);
  decoded.set(tail, leadingZeros);
  return decoded;
}

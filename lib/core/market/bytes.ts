/**
 * Compact integers for the market data files.
 *
 * Tick data is overwhelmingly small numbers once each value is written as the
 * change from the one before: a few hundred milliseconds, a few points of
 * price. A varint stores those in one or two bytes instead of four or eight,
 * and zigzag folds negatives in (0, -1, 1, -2, 2 → 0, 1, 2, 3, 4) so a small
 * fall costs as little as a small rise.
 *
 * Arithmetic rather than bit operations throughout, because JavaScript's
 * bitwise operators work on 32 bits and a price stored at three decimals
 * already needs more than that headroom for safety in sums.
 */

export class MarketFormatError extends Error {}

export const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
export const unzigzag = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

export class ByteWriter {
  private buf: Uint8Array;
  private n = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
  }

  get length() {
    return this.n;
  }

  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  u8(v: number) {
    this.room(1);
    this.buf[this.n++] = v & 0xff;
  }

  u16(v: number) {
    this.room(2);
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >>> 8) & 0xff;
  }

  u32(v: number) {
    if (!(v >= 0 && v <= 0xffffffff && Number.isInteger(v))) throw new MarketFormatError(`u32 out of range: ${v}`);
    this.room(4);
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >>> 8) & 0xff;
    this.buf[this.n++] = (v >>> 16) & 0xff;
    this.buf[this.n++] = (v >>> 24) & 0xff;
  }

  /** Unsigned varint, up to 2^53. */
  varint(v: number) {
    if (!(v >= 0 && Number.isSafeInteger(v))) throw new MarketFormatError(`varint out of range: ${v}`);
    this.room(8);
    while (v >= 128) {
      this.buf[this.n++] = (v % 128) | 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.n++] = v;
  }

  svarint(v: number) {
    this.varint(zigzag(v));
  }

  bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }

  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  /** Append another writer's bytes, prefixed by their length (u32). */
  section(w: ByteWriter) {
    this.u32(w.length);
    this.bytes(w.finish());
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

export class ByteReader {
  private i = 0;

  constructor(private readonly buf: Uint8Array, private readonly end = buf.length) {}

  get offset() {
    return this.i;
  }

  get done() {
    return this.i >= this.end;
  }

  private need(k: number) {
    if (this.i + k > this.end) throw new MarketFormatError("File is truncated.");
  }

  u8() {
    this.need(1);
    return this.buf[this.i++];
  }

  u16() {
    this.need(2);
    const v = this.buf[this.i] | (this.buf[this.i + 1] << 8);
    this.i += 2;
    return v;
  }

  u32() {
    this.need(4);
    const b = this.buf, i = this.i;
    this.i += 4;
    return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000;
  }

  varint() {
    let v = 0, mul = 1;
    for (;;) {
      this.need(1);
      const byte = this.buf[this.i++];
      v += (byte & 127) * mul;
      if (byte < 128) return v;
      mul *= 128;
      if (mul > 2 ** 56) throw new MarketFormatError("Malformed number.");
    }
  }

  svarint() {
    return unzigzag(this.varint());
  }

  ascii(k: number) {
    this.need(k);
    let s = "";
    for (let j = 0; j < k; j++) s += String.fromCharCode(this.buf[this.i + j]);
    this.i += k;
    return s;
  }

  /** A length-prefixed section, as written by ByteWriter.section. */
  section(): ByteReader {
    const len = this.u32();
    this.need(len);
    const r = new ByteReader(this.buf, this.i + len);
    r.i = this.i;
    this.i += len;
    return r;
  }
}

/** gzip, using the platform's own compressor (browsers and Node 18+). */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Hex SHA-256, for spotting a file that has already been uploaded. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

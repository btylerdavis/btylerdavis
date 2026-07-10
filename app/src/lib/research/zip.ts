/**
 * Zero-dependency ZIP writer (stored entries — no compression, no deps).
 *
 * Built for the OMOP bundle route: entries may be plain strings or async
 * chunk producers, and the whole archive is emitted as a stream. Because a
 * streamed entry's size/CRC aren't known up front, each local header sets
 * general-purpose bit 3 and a data descriptor follows the entry's bytes —
 * the standard streaming-ZIP layout (APPNOTE 4.3.9) that every unzip tool
 * reads. The central directory at the end carries the final sizes and CRCs.
 * 32-bit fields only (no ZIP64): fine for demo-scale extracts (< 4 GB).
 */

const encoder = new TextEncoder();

// --- CRC-32 (IEEE 802.3), table-driven --------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Incremental CRC-32 update. Start with 0xffffffff; finalize with ^0xffffffff. */
export function crc32Update(state: number, data: Uint8Array): number {
  let crc = state;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** One-shot CRC-32 of a buffer. */
export function crc32(data: Uint8Array): number {
  return (crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

// --- ZIP record encoding ------------------------------------------------------

export interface ZipEntry {
  name: string;
  /** entry bytes: a whole string, or a factory for an async chunk stream */
  data: string | (() => AsyncIterable<string | Uint8Array>);
}

const FLAG_DATA_DESCRIPTOR_UTF8 = 0x0808; // bit 3 (descriptor) + bit 11 (UTF-8 names)
const METHOD_STORED = 0;
const VERSION_NEEDED = 20;

function dosTime(date: Date): number {
  return (
    ((date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1)) &
    0xffff
  );
}

function dosDate(date: Date): number {
  return (
    ((Math.max(0, date.getUTCFullYear() - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate()) &
    0xffff
  );
}

class ByteWriter {
  private view: DataView;
  private bytes: Uint8Array;
  private at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this {
    this.view.setUint16(this.at, value & 0xffff, true);
    this.at += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }

  raw(data: Uint8Array): this {
    this.bytes.set(data, this.at);
    this.at += data.length;
    return this;
  }

  done(): Uint8Array {
    return this.bytes;
  }
}

interface CentralRecordInput {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  localOffset: number;
  time: number;
  date: number;
}

function localHeader(nameBytes: Uint8Array, time: number, date: number): Uint8Array {
  return new ByteWriter(30 + nameBytes.length)
    .u32(0x04034b50)
    .u16(VERSION_NEEDED)
    .u16(FLAG_DATA_DESCRIPTOR_UTF8)
    .u16(METHOD_STORED)
    .u16(time)
    .u16(date)
    .u32(0) // crc — in the data descriptor
    .u32(0) // compressed size — in the data descriptor
    .u32(0) // uncompressed size — in the data descriptor
    .u16(nameBytes.length)
    .u16(0) // extra length
    .raw(nameBytes)
    .done();
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  return new ByteWriter(16).u32(0x08074b50).u32(crc).u32(size).u32(size).done();
}

function centralRecord(input: CentralRecordInput): Uint8Array {
  return new ByteWriter(46 + input.nameBytes.length)
    .u32(0x02014b50)
    .u16(VERSION_NEEDED) // version made by
    .u16(VERSION_NEEDED) // version needed
    .u16(FLAG_DATA_DESCRIPTOR_UTF8)
    .u16(METHOD_STORED)
    .u16(input.time)
    .u16(input.date)
    .u32(input.crc)
    .u32(input.size) // compressed (stored: same)
    .u32(input.size)
    .u16(input.nameBytes.length)
    .u16(0) // extra
    .u16(0) // comment
    .u16(0) // disk number
    .u16(0) // internal attrs
    .u32(0) // external attrs
    .u32(input.localOffset)
    .raw(input.nameBytes)
    .done();
}

function endOfCentralDirectory(count: number, cdSize: number, cdOffset: number): Uint8Array {
  return new ByteWriter(22)
    .u32(0x06054b50)
    .u16(0) // disk
    .u16(0) // cd disk
    .u16(count)
    .u16(count)
    .u32(cdSize)
    .u32(cdOffset)
    .u16(0) // comment length
    .done();
}

async function* entryChunks(data: ZipEntry["data"]): AsyncIterable<Uint8Array> {
  if (typeof data === "string") {
    yield encoder.encode(data);
    return;
  }
  for await (const chunk of data()) {
    yield typeof chunk === "string" ? encoder.encode(chunk) : chunk;
  }
}

async function* generateZip(entries: ZipEntry[], modified: Date): AsyncGenerator<Uint8Array> {
  const time = dosTime(modified);
  const date = dosDate(modified);
  const central: CentralRecordInput[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const localOffset = offset;
    const header = localHeader(nameBytes, time, date);
    offset += header.length;
    yield header;

    let crcState = 0xffffffff;
    let size = 0;
    for await (const chunk of entryChunks(entry.data)) {
      if (chunk.length === 0) continue;
      crcState = crc32Update(crcState, chunk);
      size += chunk.length;
      offset += chunk.length;
      yield chunk;
    }

    const crc = (crcState ^ 0xffffffff) >>> 0;
    const descriptor = dataDescriptor(crc, size);
    offset += descriptor.length;
    yield descriptor;

    central.push({ nameBytes, crc, size, localOffset, time, date });
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const record of central) {
    const bytes = centralRecord(record);
    cdSize += bytes.length;
    yield bytes;
  }
  yield endOfCentralDirectory(central.length, cdSize, cdOffset);
}

/** The archive as a web ReadableStream — hand it straight to a Response. */
export function zipStream(
  entries: ZipEntry[],
  opts: { modified?: Date } = {}
): ReadableStream<Uint8Array> {
  const iterator = generateZip(entries, opts.modified ?? new Date());
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

/** Whole archive in memory — the test harness's entry point. */
export async function zipBytes(
  entries: ZipEntry[],
  opts: { modified?: Date } = {}
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of generateZip(entries, opts.modified ?? new Date())) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

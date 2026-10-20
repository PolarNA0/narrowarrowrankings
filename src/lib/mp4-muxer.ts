/**
 * A minimal streaming MP4 (ISO BMFF) writer for a single H.264 video track, fed
 * by the WebCodecs `VideoEncoder`.
 *
 * Why streaming: the previous muxer took an array of every encoded frame and
 * built the whole file in one pass at the end, so the clip existed twice in
 * memory at the finish (the encoded frames plus the concatenated `mdat`) and a
 * long or high-resolution export peaked high enough to take the tab down — the
 * reported crash. This writer instead appends each frame's bytes to an ordered
 * list of `Blob` parts as the encoder emits them, and only materialises the
 * small header tables at the end. The frames are never copied a second time.
 *
 * The output plays everywhere: QuickTime, Windows Media Player, mobile galleries
 * and Safari all open H.264-in-MP4, unlike WebM (which those players show as a
 * grey "unsupported" frame).
 *
 * Only the boxes a player needs to demux and decode one track are written:
 * `ftyp`, `moov` (`mvhd`, one `trak` with `stsd`/`avcC`, `stts`, `stss`, `stsc`,
 * `stsz`, `stco`) and `mdat`. Samples are one chunk, so `stco` holds a single
 * offset. No edit lists, no fragmented MP4, no metadata tracks.
 */

const VIDEO_TIMESCALE = 90_000;

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const u8 = (...v: number[]) => new Uint8Array(v);
const u16 = (v: number) => new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
const u32 = (v: number) =>
  new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
const ascii = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** `[size][type][body…]`. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  out.set(u32(out.length), 0);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}

/** A box whose body starts with a full-box header (version + 24-bit flags). */
function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...parts);
}

/** The unity display matrix shared by `mvhd` and `tkhd`. */
const UNITY_MATRIX = concat([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
]);

export interface Mp4StreamOptions {
  width: number;
  height: number;
  fps: number;
  /** Exact clip duration in milliseconds (drives the `mvhd`/`tkhd`/`mdhd` duration). */
  durationMs: number;
  /** `AVCDecoderConfigurationRecord` (avcC payload) from the encoder's decoder config. */
  description: Uint8Array;
}

/** Run-length encode `[count, value]` pairs for a delta table. */
function runLength(values: number[]): Uint8Array {
  const entries: Array<[number, number]> = [];
  for (const v of values) {
    const last = entries[entries.length - 1];
    if (last && last[1] === v) last[0]++;
    else entries.push([1, v]);
  }
  const out = new Uint8Array(4 + entries.length * 8);
  out.set(u32(entries.length), 0);
  let off = 4;
  for (const [count, value] of entries) {
    out.set(u32(count), off);
    out.set(u32(value), off + 4);
    off += 8;
  }
  return out;
}

/**
 * Append-only MP4 writer. `addFrame` is called once per encoded chunk; `finish`
 * writes the header tables (which need the sample list) and returns the file.
 */
export class Mp4Writer {
  private readonly sizes: number[] = [];
  private readonly keyframes: boolean[] = [];
  private readonly parts: BlobPart[] = [];
  private mdatLen = 0;
  private finished = false;

  constructor(private readonly opts: Mp4StreamOptions) {}

  /** Append one length-prefixed (AVCC) H.264 access unit. */
  addFrame(data: Uint8Array, keyframe: boolean): void {
    this.parts.push(data as BlobPart);
    this.mdatLen += data.length;
    this.sizes.push(data.length);
    this.keyframes.push(keyframe);
  }

  /** Write the header tables and return the finished MP4 blob. */
  finish(): Blob {
    if (this.finished) throw new Error("Mp4Writer.finish() called twice");
    this.finished = true;
    const { width, height, fps, durationMs, description } = this.opts;
    const n = this.sizes.length;

    const delta = Math.max(1, Math.round(VIDEO_TIMESCALE / fps));
    const total = Math.max(1, Math.round((durationMs / 1000) * VIDEO_TIMESCALE));
    const deltas: number[] = [];
    for (let i = 0; i < n; i++)
      deltas.push(i === n - 1 ? Math.max(1, total - delta * (n - 1)) : delta);

    const syncSamples: number[] = [];
    this.keyframes.forEach((k, i) => {
      if (k || i === 0) syncSamples.push(i + 1);
    });

    const ftyp = box(
      "ftyp",
      ascii("isom"),
      u32(0x200),
      ascii("isom"),
      ascii("iso2"),
      ascii("avc1"),
      ascii("mp41"),
    );

    const mvhd = fullBox(
      "mvhd",
      0,
      0,
      u32(0),
      u32(0),
      u32(VIDEO_TIMESCALE),
      u32(total),
      u32(0x00010000),
      u16(0x0100),
      u16(0),
      u32(0),
      u32(0),
      UNITY_MATRIX,
      u32(0),
      u32(2),
    );

    const tkhd = fullBox(
      "tkhd",
      0,
      0x7,
      u32(0),
      u32(0),
      u32(1),
      u32(0),
      u32(total),
      u32(0),
      u32(0),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      UNITY_MATRIX,
      u32((width << 16) >>> 0),
      u32((height << 16) >>> 0),
    );

    const mdhd = fullBox(
      "mdhd",
      0,
      0,
      u32(0),
      u32(0),
      u32(VIDEO_TIMESCALE),
      u32(total),
      u16(0x55c4),
      u16(0),
    );

    const hdlr = fullBox(
      "hdlr",
      0,
      0,
      u32(0),
      ascii("vide"),
      u32(0),
      u32(0),
      u32(0),
      ascii("VideoHandler\0"),
    );

    const avcC = box("avcC", description);
    const avc1 = box(
      "avc1",
      u8(0, 0, 0, 0, 0, 0),
      u16(1),
      u16(0),
      u16(0),
      u32(0),
      u32(0),
      u32(0),
      u16(width),
      u16(height),
      u32(0x00480000),
      u32(0x00480000),
      u32(0),
      u16(1),
      new Uint8Array(32), // compressorname
      u16(0x0018),
      u16(0xffff),
      avcC,
    );
    const stsd = fullBox("stsd", 0, 0, u32(1), avc1);

    const stts = fullBox("stts", 0, 0, runLength(deltas));

    const stssBody = new Uint8Array(4 + syncSamples.length * 4);
    stssBody.set(u32(syncSamples.length), 0);
    syncSamples.forEach((s, i) => stssBody.set(u32(s), 4 + i * 4));
    const stss = fullBox("stss", 0, 0, stssBody);

    // One chunk holding every sample, so a single chunk offset suffices.
    const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1));

    const stszBody = new Uint8Array(8 + n * 4);
    stszBody.set(u32(0), 0);
    stszBody.set(u32(n), 4);
    this.sizes.forEach((size, i) => stszBody.set(u32(size), 8 + i * 4));
    const stsz = fullBox("stsz", 0, 0, stszBody);

    const vmhd = fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0));
    const url = fullBox("url ", 0, 1);
    const dref = fullBox("dref", 0, 0, u32(1), url);
    const dinf = box("dinf", dref);

    const moovOf = (stco: Uint8Array) =>
      box(
        "moov",
        mvhd,
        box(
          "trak",
          tkhd,
          box(
            "mdia",
            mdhd,
            hdlr,
            box("minf", vmhd, dinf, box("stbl", stsd, stts, stss, stsc, stsz, stco)),
          ),
        ),
      );

    // `stco` is the only box whose body depends on where `mdat` lands, and its
    // size is fixed, so build the file once with a zero offset purely to measure
    // the header, then rebuild with the real offset.
    const moovPlaceholder = moovOf(fullBox("stco", 0, 0, u32(1), u32(0)));
    const mdatHeader = 8;
    const dataOffset = ftyp.length + moovPlaceholder.length + mdatHeader;
    const moov = moovOf(fullBox("stco", 0, 0, u32(1), u32(dataOffset)));
    if (moov.length !== moovPlaceholder.length) {
      throw new Error("MP4 header size drifted while writing stco");
    }

    const mdatHeaderBytes = concat([u32(mdatHeader + this.mdatLen), ascii("mdat")]);

    // The Blob copies each part once, so hand it the header, the tables and the
    // encoded frames directly — no concatenated copy of the whole clip.
    return new Blob(
      [ftyp as BlobPart, moov as BlobPart, mdatHeaderBytes as BlobPart, ...this.parts],
      { type: "video/mp4" },
    );
  }
}

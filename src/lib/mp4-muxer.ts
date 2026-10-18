/**
 * A minimal MP4 (ISO BMFF) muxer for a single H.264 video track, fed by the
 * WebCodecs `VideoEncoder`.
 *
 * The offline exporter used to write WebM/VP9. Chrome plays that back fine, but
 * WebM is not a universal container: QuickTime, Windows Media Player, many
 * mobile galleries and older Safari cannot open it at all and show their media
 * error placeholder (a grey frame with a sad face). H.264 in MP4 plays
 * everywhere, so it is the default output and WebM is only the fallback for
 * browsers whose encoder cannot produce H.264.
 *
 * Only the boxes a player needs to demux and decode one track are written:
 * `ftyp`, `moov` (`mvhd`, one `trak` with `stsd`/`avcC`, `stts`, `stss`,
 * `stsc`, `stsz`, `stco`) and `mdat`. Samples are one chunk, so `stco` holds a
 * single offset. No edit lists, no fragmented MP4, no metadata tracks.
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
/** 64-bit big-endian; values here stay well inside 2^53. */
const u64 = (v: number) => concat([u32(Math.floor(v / 4294967296)), u32(v >>> 0)]);
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

export interface Mp4Frame {
  /** Length-prefixed (AVCC) H.264 access unit, exactly as the encoder emitted it. */
  data: Uint8Array;
  /** Presentation time in milliseconds. */
  timestampMs: number;
  keyframe: boolean;
}

export interface Mp4Options {
  width: number;
  height: number;
  fps: number;
  /** Exact clip duration in milliseconds. */
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
 * Mux encoded H.264 frames into a playable MP4 blob. Timing comes from the
 * encoder's own timestamps, so the clip is frame-exact rather than wall-clock.
 */
export function muxMp4(frames: Mp4Frame[], opts: Mp4Options): Blob {
  const n = frames.length;
  const delta = Math.max(1, Math.round(VIDEO_TIMESCALE / opts.fps));
  const total = Math.max(1, Math.round((opts.durationMs / 1000) * VIDEO_TIMESCALE));
  const deltas: number[] = [];
  for (let i = 0; i < n; i++)
    deltas.push(i === n - 1 ? Math.max(1, total - delta * (n - 1)) : delta);

  const syncSamples: number[] = [];
  frames.forEach((f, i) => {
    if (f.keyframe || i === 0) syncSamples.push(i + 1);
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
    u32((opts.width << 16) >>> 0),
    u32((opts.height << 16) >>> 0),
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

  const avcC = box("avcC", opts.description);
  const avc1 = box(
    "avc1",
    u8(0, 0, 0, 0, 0, 0),
    u16(1),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(opts.width),
    u16(opts.height),
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
  frames.forEach((f, i) => stszBody.set(u32(f.data.length), 8 + i * 4));
  const stsz = fullBox("stsz", 0, 0, stszBody);

  const vmhd = fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0));
  const url = fullBox("url ", 0, 1);
  const dref = fullBox("dref", 0, 0, u32(1), url);
  const dinf = box("dinf", dref);

  const moovNoStco = box(
    "moov",
    mvhd,
    box(
      "trak",
      tkhd,
      box("mdia", mdhd, hdlr, box("minf", vmhd, dinf, box("stbl", stsd, stts, stss, stsc, stsz))),
    ),
  );

  // `stco` is built after we know where `mdat` lands. `stco` is inside `moov`,
  // so its own size must be known first — it is fixed (one entry).
  const stcoEmpty = fullBox("stco", 0, 0, u32(1), u32(0));
  const moovLen = moovNoStco.length + stcoEmpty.length;
  const mdatPayload = concat(frames.map((f) => f.data));
  const mdatHeader = 8;
  const dataOffset = ftyp.length + moovLen + mdatHeader;
  const stco = fullBox("stco", 0, 0, u32(1), u32(dataOffset));

  const moov = box(
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

  const mdat = box("mdat", mdatPayload);

  return new Blob([concat([ftyp, moov, mdat]) as BlobPart], { type: "video/mp4" });
}

/**
 * A minimal streaming WebM (Matroska) writer for a single video track of
 * VP8/VP9 inter frames, fed by the WebCodecs `VideoEncoder`.
 *
 * This is the fallback container for browsers that cannot encode H.264; the
 * default is MP4 (`mp4-muxer.ts`), which every desktop and mobile player opens.
 * Like that writer, it appends each frame as the encoder emits it rather than
 * buffering the whole clip and muxing at the end, so a long export does not
 * double its peak memory. The Segment is declared with an unknown size, so the
 * file needs no second pass once the frames are written.
 *
 * Only the elements a player needs to demux and decode the track are written:
 * EBML header, Segment > Info (timecode scale + duration), Tracks (one video
 * track) and Clusters of SimpleBlocks. Cues, seek tables and metadata are
 * omitted; every browser and ffmpeg play a stream like this fine.
 */

/** Growable big-endian byte buffer, so large frame payloads are never spread. */
class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 0;

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(b: number) {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  bytes(b: ArrayLike<number>) {
    this.ensure(b.length);
    this.buf.set(b as Uint8Array, this.len);
    this.len += b.length;
  }

  /** EBML data-size VINT for `value` (marker bit set, 1–4 bytes). */
  vint(value: number) {
    if (value < 0x7f) return this.u8(0x80 | value);
    if (value < 0x3fff) return this.bytes([0x40 | (value >> 8), value & 0xff]);
    if (value < 0x1fffff)
      return this.bytes([0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff]);
    return this.bytes([
      0x10 | (value >> 24),
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ]);
  }

  float64(value: number) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);
    this.bytes(new Uint8Array(buf));
  }

  ascii(text: string) {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i++) this.buf[this.len++] = text.charCodeAt(i) & 0xff;
  }

  /** Append an element: id bytes, a data-size VINT, then the body bytes. */
  element(id: number[], body: ArrayLike<number>) {
    this.bytes(id);
    this.vint(body.length);
    this.bytes(body);
  }

  get result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** Big-endian EBML uint bytes for a standalone element body. */
function uintBytes(value: number): number[] {
  if (value === 0) return [0];
  const bytes: number[] = [];
  let v = Math.round(value);
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return bytes;
}

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  simpleBlock: [0xa3],
  ebmlVersion: [0x42, 0x86],
  ebmlReadVersion: [0x42, 0xf7],
  ebmlMaxIdLength: [0x42, 0xf2],
  ebmlMaxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82],
  docTypeVersion: [0x42, 0x87],
  docTypeReadVersion: [0x42, 0x85],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  duration: [0x44, 0x89],
  muxingApp: [0x4d, 0x80],
  writingApp: [0x57, 0x41],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackUid: [0x73, 0xc5],
  trackType: [0x83],
  codecId: [0x86],
  defaultDuration: [0x23, 0xe3, 0x83],
  video: [0xe0],
  pixelWidth: [0xb0],
  pixelHeight: [0xba],
};

export interface WebMStreamOptions {
  width: number;
  height: number;
  /** Matroska codec id: `V_VP8` or `V_VP9`. */
  codec: "V_VP8" | "V_VP9";
  /** Track duration in milliseconds, written to Segment > Info. */
  durationMs: number;
  /** Nominal frame duration in ns, written to the track (optional hint). */
  defaultDurationNs?: number;
}

/**
 * Append-only WebM writer. Frames are accumulated into a cluster until the next
 * keyframe, then the finished cluster's bytes are appended to the output part
 * list — so at most one cluster's worth of encoded frames is held at a time.
 */
export class WebMWriter {
  private readonly parts: BlobPart[] = [];
  private group: Array<{ data: Uint8Array; timestamp: number; keyframe: boolean }> = [];
  private base = 0;
  private finished = false;

  constructor(private readonly opts: WebMStreamOptions) {
    this.parts.push(this.header() as BlobPart);
  }

  /** Append one encoded VP8/VP9 frame at its presentation time in ms. */
  addFrame(data: Uint8Array, timestamp: number, keyframe: boolean): void {
    if (keyframe && this.group.length) {
      this.flush();
      this.base = Math.round(timestamp);
    }
    this.group.push({ data, timestamp, keyframe });
  }

  private flush(): void {
    const group = this.group;
    if (!group.length) return;
    const body = new ByteWriter();
    body.element(ID.timecode, uintBytes(this.base));
    for (const f of group) {
      const rel = Math.max(-32768, Math.min(32767, Math.round(f.timestamp - this.base)));
      const block = new ByteWriter();
      block.u8(0x81); // track number 1 as a VINT
      block.bytes([(rel >> 8) & 0xff, rel & 0xff]);
      block.u8(f.keyframe ? 0x80 : 0x00);
      block.bytes(f.data);
      body.element(ID.simpleBlock, block.result);
    }
    // Wrap the timecode + blocks in a Cluster element; without this the blocks
    // are written straight into the Segment and no demuxer can read them.
    const cluster = new ByteWriter();
    cluster.element(ID.cluster, body.result);
    this.parts.push(cluster.result as BlobPart);
    this.group = [];
  }

  /** Flush the last cluster and return the finished WebM blob. */
  finish(): Blob {
    if (this.finished) throw new Error("WebMWriter.finish() called twice");
    this.finished = true;
    this.flush();
    return new Blob(this.parts, { type: "video/webm" });
  }

  private header(): Uint8Array {
    const w = new ByteWriter();

    // EBML header.
    {
      const body = new ByteWriter();
      body.element(ID.ebmlVersion, [1]);
      body.element(ID.ebmlReadVersion, [1]);
      body.element(ID.ebmlMaxIdLength, [4]);
      body.element(ID.ebmlMaxSizeLength, [8]);
      const docType = new ByteWriter();
      docType.ascii("webm");
      body.element(ID.docType, docType.result);
      body.element(ID.docTypeVersion, [2]);
      body.element(ID.docTypeReadVersion, [2]);
      w.element(ID.ebml, body.result);
    }

    // Segment, written with an unknown-size header so its length need not be
    // known up front (the whole clip is built in memory and concatenated at the
    // end). `0x01 ff…` is the 8-byte "unknown size" VINT.
    w.bytes(ID.segment);
    w.bytes([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

    // Info: 1ms timecode scale and the exact duration.
    {
      const body = new ByteWriter();
      body.element(ID.timecodeScale, [0x0f, 0x42, 0x40]); // 1_000_000
      const dur = new ByteWriter();
      dur.float64(this.opts.durationMs);
      body.element(ID.duration, dur.result);
      const mux = new ByteWriter();
      mux.ascii("na-rankings");
      body.element(ID.muxingApp, mux.result);
      const write = new ByteWriter();
      write.ascii("na-rankings");
      body.element(ID.writingApp, write.result);
      w.element(ID.info, body.result);
    }

    // Tracks: one video track.
    {
      const track = new ByteWriter();
      track.element(ID.trackNumber, [1]);
      track.element(ID.trackUid, [1]);
      track.element(ID.trackType, [1]); // 1 = video
      const codec = new ByteWriter();
      codec.ascii(this.opts.codec);
      track.element(ID.codecId, codec.result);
      if (this.opts.defaultDurationNs)
        track.element(ID.defaultDuration, uintBytes(this.opts.defaultDurationNs));
      const video = new ByteWriter();
      video.element(ID.pixelWidth, uintBytes(this.opts.width));
      video.element(ID.pixelHeight, uintBytes(this.opts.height));
      track.element(ID.video, video.result);
      const tracks = new ByteWriter();
      tracks.element(ID.trackEntry, track.result);
      w.element(ID.tracks, tracks.result);
    }

    return w.result;
  }
}

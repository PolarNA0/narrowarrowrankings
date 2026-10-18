// WebGL2 renderer that drives the game's OWN fragment shaders.
//
// The shader sources live in js/shaders.js, ported verbatim from the game
// (APK v2.4.8 assets/shaders/*.frag, GLSL ES 3.00 blocks). The game runs them
// through Flutter, where `_fragCoord` is a varying carrying TOP-LEFT screen
// pixels; here that is reconstructed from gl_FragCoord + uRes.
//
// Usage mirrors the game:
//   - walls        : solid band (js/render.js) + wall_contact overlay on contact
//   - finish line  : finish_line_grid.frag (black/white checker)
//   - portals      : portal_particles.frag (particle band along the segment)
//   - thrust       : thrust_<skin>.frag, else thrust_default.frag
//   - background   : background_{grid,dots,circles,squares}.frag
import * as SH from './shaders.js';
import { TRAIL_VERTEX, TRAIL_FRAG, TRAIL_STYLES } from './trail-shaders.js';

const VS_QUAD = `#version 300 es
in vec2 aPos;                       // screen pixels, y down
uniform highp vec2 uRes;
void main(){ gl_Position = vec4(aPos.x/uRes.x*2.0-1.0, 1.0-aPos.y/uRes.y*2.0, 0.0, 1.0); }`;

const FS_SPRITE = `#version 300 es
precision mediump float;
in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; uniform vec3 uTint;
out vec4 fragColor;
void main(){ vec4 c = texture(uTex, vUV); fragColor = vec4(c.rgb*uTint, c.a*uAlpha); }`;

const VS_SPRITE = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform highp vec2 uRes; uniform vec4 uRot; out vec2 vUV;
void main(){
  vUV = aUV;
  vec2 p = aPos - uRot.zw;                          // rotate about the sprite centre
  vec2 rp = vec2(p.x*uRot.x - p.y*uRot.y, p.x*uRot.y + p.y*uRot.x);
  vec2 outP = rp + uRot.zw;
  gl_Position = vec4(outP.x/uRes.x*2.0-1.0, 1.0-outP.y/uRes.y*2.0, 0.0, 1.0);
}`;

const FS_FLAT = `#version 300 es
precision mediump float; uniform vec4 uColor; out vec4 fragColor;
void main(){ fragColor = uColor; }`;

// Blit: sample a texture across a full-screen quad (used to upscale the
// half-resolution background pass). `y` is flipped so GL's bottom-up texture
// rows line up with the top-left screen convention the rest of the code uses.
const VS_BLIT = `#version 300 es
in vec2 aPos; uniform highp vec2 uRes; out vec2 vUV;
void main(){
  vUV = vec2(aPos.x/uRes.x, 1.0 - aPos.y/uRes.y);
  gl_Position = vec4(aPos.x/uRes.x*2.0-1.0, 1.0-aPos.y/uRes.y*2.0, 0.0, 1.0);
}`;
const FS_BLIT = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; out vec4 fragColor;
void main(){ fragColor = texture(uTex, vUV); }`;

// Filled circle (collision hitbox) or ring (collisionCircle outline). Screen px.
const FS_CIRCLE = `#version 300 es
precision mediump float;
uniform highp vec2 uRes; uniform vec2 uCenter; uniform float uRadius; uniform float uLine;
uniform vec4 uColor;
out vec4 fragColor;
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float d = length(fc - uCenter);
  if (d > uRadius + uLine) discard;
  float a = uColor.a;
  if (uLine > 0.0) {
    float inner = smoothstep(uRadius - uLine, uRadius - uLine*0.5, d);
    float outer = 1.0 - smoothstep(uRadius + uLine*0.5, uRadius + uLine, d);
    a *= inner * outer;
  }
  fragColor = vec4(uColor.rgb, a);
}`;

// Solid wall: a capsule (segment with round caps) clipped in the fragment
// shader. The game strokes walls as a line with a round cap and round join, so
// every segment gets rounded ends and corners render as round joins; the SDF
// below reproduces that and antialiases the edge in the same pass.
const FS_WALL_SOLID = `#version 300 es
precision mediump float;
uniform highp vec2 uRes;
uniform float uCenterX,uCenterY,uDirX,uDirY,uSideSign,uLength,uHalfWidth,uColorR,uColorG,uColorB;
out vec4 fragColor;
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 dir = normalize(vec2(uDirX,uDirY));
  vec2 rel = fc - vec2(uCenterX,uCenterY);
  float along = dot(rel,dir);
  float across = abs(-dot(rel,vec2(-dir.y,dir.x)));
  float cl = clamp(along, 0.0, uLength);
  float d = length(vec2(along-cl, across));
  float a = 1.0 - smoothstep(uHalfWidth-1.0, uHalfWidth+0.5, d);
  if(a<=0.0){ fragColor=vec4(0.0); return; }
  fragColor = vec4(uColorR,uColorG,uColorB,a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}

// Create a program and auto-discover its active uniforms/attribs.
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const o = { p, u: {}, a: {} };
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    o.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    o.a[info.name] = gl.getAttribLocation(p, info.name);
  }
  return o;
}

const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];   // identity for shaders' optional uInvCol* tilt

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl; this.canvas = canvas;

    this.vbuf = gl.createBuffer();     // dynamic screen-px quad (px, or px+uv)
    this.tex = {};                     // key -> GL texture

    const P = (fs, vs = VS_QUAD) => program(gl, vs, fs);
    this.bg = {
      grid: P(SH.background_grid),
      dots: P(SH.background_dots),
      circles: P(SH.background_circles),
      squares: P(SH.background_squares),
    };
    this.finish = P(SH.finish_line_grid);
    this.portal = P(SH.portal_particles);
    this.wall = P(FS_WALL_SOLID);
    this.contact = P(SH.wall_contact);
    this.thrust = { default: P(SH.thrust_default) };
    for (const k of Object.keys(SH)) {
      if (k.startsWith('thrust_') && k !== 'thrust_default') this.thrust[k.slice(7)] = P(SH[k]);
    }
    this.sprite = P(FS_SPRITE, VS_SPRITE);
    this.flat = P(FS_FLAT);
    this.circle = P(FS_CIRCLE);
    this.blit = P(FS_BLIT, VS_BLIT);

    // Trail: the game's world-space mesh shaders, one program per style.
    this.trail = {};
    for (const k of TRAIL_STYLES) this.trail[k] = program(gl, TRAIL_VERTEX, TRAIL_FRAG[k]);
    this.trailMesh = gl.createBuffer();   // interleaved [x,y,z, along, lateral]
    this.trailWhite = this._solidTex([255, 255, 255, 255]);

    // Offscreen target for the half-resolution background pass.
    this.bgFbo = gl.createFramebuffer();
    this.bgTex = gl.createTexture();
    this.bgW = this.bgH = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // 1x1 transparent texture for the thrust shaders' uImage sampler.
    this.blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  setSize(w, h) {
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    // The procedural background is shaded into an offscreen target and blitted
    // back. It runs at FULL canvas resolution: shading it at a fraction (a former
    // "half-res pass" optimisation) upscaled a sub-pixel pattern and made the
    // grid/dots shimmer as the camera moved, which is worse than the fill it
    // saved. bgDiv stays available but must be 1 for correct output.
    this.bgDiv = 1;
    const bw = Math.max(1, Math.round(w / this.bgDiv)), bh = Math.max(1, Math.round(h / this.bgDiv));
    if (bw !== this.bgW || bh !== this.bgH) {
      this.bgW = bw; this.bgH = bh;
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bgTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  texture(key, image) {
    if (this.tex[key]) return this.tex[key];
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex[key] = t; return t;
  }

  // A 1x1 solid-colour texture (the trail shaders' `uImage` when no trail image
  // is configured; uHasImage=0 makes the mix a no-op, but a bound texture is
  // still required by the sampler).
  _solidTex(rgba) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // world point -> top-left screen pixels
  project(cam, W, H, x, y) {
    return { x: W / 2 + (x - cam.x) * cam.zoom, y: H / 2 + (y - cam.y) * cam.zoom };
  }

  _rect(x0, y0, x1, y1) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];
  }

  // Upload a quad (tl,tr,bl,br screen px) and return the buffer for _bindPos.
  _quad(corners, withUV = false) {
    const gl = this.gl;
    const [c0, c1, c2, c3] = corners;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
    const data = withUV
      ? new Float32Array([
          c0.x, c0.y, 0, 0, c1.x, c1.y, 1, 0, c2.x, c2.y, 0, 1,
          c2.x, c2.y, 0, 1, c1.x, c1.y, 1, 0, c3.x, c3.y, 1, 1])
      : new Float32Array([
          c0.x, c0.y, c1.x, c1.y, c2.x, c2.y,
          c2.x, c2.y, c1.x, c1.y, c3.x, c3.y]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  _bindPos(prog, stride = 0) {
    const gl = this.gl;
    gl.enableVertexAttribArray(prog.a.aPos);
    gl.vertexAttribPointer(prog.a.aPos, 2, gl.FLOAT, false, stride, 0);
  }

  _use(prog) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    if (prog.u.uRes) gl.uniform2f(prog.u.uRes, this.canvas.width, this.canvas.height);
  }

  _identityTilt(prog) {
    const gl = this.gl, u = prog.u;
    if (u.uTilt) gl.uniform1f(u.uTilt, 0);
    if (u.uInvCol0) gl.uniform3fv(u.uInvCol0, IDENT3.slice(0, 3));
    if (u.uInvCol1) gl.uniform3fv(u.uInvCol1, IDENT3.slice(3, 6));
    if (u.uInvCol2) gl.uniform3fv(u.uInvCol2, IDENT3.slice(6, 9));
  }

  // Build the two screen-space basis vectors the thrust shaders expect:
  //   vX = dot(p, uBasisX) = across / halfWidth   (in [-1,1])
  //   vY = dot(p, uBasisY) = along  / length      (in [0,1])
  _thrustBasis(dx, dy, length, halfWidth) {
    const px = -dy, py = dx;
    return {
      bx: [px / Math.max(halfWidth, 1e-3), py / Math.max(halfWidth, 1e-3)],
      by: [dx / Math.max(length, 1e-3), dy / Math.max(length, 1e-3)],
    };
  }

  begin(W, H, t, bgVariant, cam) {
    const gl = this.gl;
    const prog = this.bg[bgVariant];
    const bw = this.bgW, bh = this.bgH;
    const invDiv = 1 / (this.bgDiv || 2);

    // Pass A: the full-screen procedural background at half resolution, into the
    // offscreen target. It is by far the most fill-bound pass, so shading a
    // quarter of the pixels (then upscaling) is the single biggest win.
    if (prog && bw && bh) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo);
      gl.viewport(0, 0, bw, bh);
      gl.disable(gl.BLEND);
      this._use(prog);
      this._identityTilt(prog);
      const u = prog.u;
      // Feed the reduced size as the shader's resolution AND scale the zoom by
      // the same factor, so the background keeps the same world extent on screen.
      if (u.uRes) gl.uniform2f(u.uRes, bw, bh);
      if (u.uResolution) gl.uniform2f(u.uResolution, bw, bh);
      if (u.uZoom) gl.uniform1f(u.uZoom, cam.zoom * invDiv);
      if (u.uCameraPos) gl.uniform2f(u.uCameraPos, cam.x, cam.y);
      if (u.uTime) gl.uniform1f(u.uTime, t);
      if (u.uGridScale) gl.uniform1f(u.uGridScale, 1.0);
      if (u.uProjectionMode) gl.uniform1f(u.uProjectionMode, 0.0);
      if (u.uSquaresUpperBoundsAndMode) gl.uniform3f(u.uSquaresUpperBoundsAndMode, 0.6667, 0.6667, 0.0);
      if (u.uSquaresLayer0ColorAndLower) gl.uniform4f(u.uSquaresLayer0ColorAndLower, 1, 1, 1, 0.3333);
      if (u.uSquaresLayer1ColorAndLower) gl.uniform4f(u.uSquaresLayer1ColorAndLower, 1, 1, 1, 0.3333);
      this._quad(this._rect(0, 0, bw, bh));
      this._bindPos(prog);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // Pass B: clear the main target and upscale the background into it (or fill
    // black when the background is disabled). A shader blit is cheap next to the
    // background pass it replaces.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (prog && bw && bh) {
      gl.disable(gl.BLEND);
      this._use(this.blit);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.uniform1i(this.blit.u.uTex, 0);
      this._quad(this._rect(0, 0, W, H));
      this._bindPos(this.blit);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  drawFlatRect(W, H, x0, y0, x1, y1, r, g, b, a) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.flat);
    gl.uniform4f(this.flat.u.uColor, r, g, b, a);
    this._quad(this._rect(x0, y0, x1, y1));
    this._bindPos(this.flat);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawPoly(W, H, pts, r, g, b, a) {
    if (pts.length < 3) return;
    const gl = this.gl, p = this.flat;
    this._use(p);
    gl.uniform4f(p.u.uColor, r, g, b, a);
    if (!this.polyBuf) this.polyBuf = gl.createBuffer();
    const tri = [];
    for (let i = 1; i < pts.length - 1; i++) {
      tri.push(pts[0].x, pts[0].y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, tri.length / 2);
  }

  // Circle in screen px. line=0 -> filled disc; line>0 -> ring of that width.
  drawCircle(W, H, cx, cy, radius, r, g, b, a, line = 0) {
    const gl = this.gl, p = this.circle;
    const pad = radius + line + 2;
    this._use(p);
    gl.uniform2f(p.u.uCenter, cx, cy);
    gl.uniform1f(p.u.uRadius, radius);
    gl.uniform1f(p.u.uLine, line);
    gl.uniform4f(p.u.uColor, r, g, b, a);
    this._quad(this._rect(cx - pad, cy - pad, cx + pad, cy + pad));
    this._bindPos(p);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _bandBounds(A, B, px, py) {
    return {
      x0: Math.min(A.x, B.x, A.x + px, B.x + px, A.x - px, B.x - px),
      x1: Math.max(A.x, B.x, A.x + px, B.x + px, A.x - px, B.x - px),
      y0: Math.min(A.y, B.y, A.y + py, B.y + py, A.y - py, B.y - py),
      y1: Math.max(A.y, B.y, A.y + py, B.y + py, A.y - py, B.y - py),
    };
  }

  // Solid wall capsule: A,B screen px centre line, half = screen half-thickness.
  // The shader rounds the ends (round cap), so corners meet as round joins.
  drawWall(W, H, A, B, half, color) {
    const gl = this.gl;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const pad = half + 2;
    const ex = ux * pad, ey = uy * pad;          // along the segment (round caps)
    const nx = -uy * pad, ny = ux * pad;         // across the segment
    const xs = [A.x - ex + nx, A.x - ex - nx, B.x + ex + nx, B.x + ex - nx];
    const ys = [A.y - ey + ny, A.y - ey - ny, B.y + ey + ny, B.y + ey - ny];
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.wall);
    const u = this.wall.u;
    gl.uniform1f(u.uCenterX, A.x); gl.uniform1f(u.uCenterY, A.y);
    gl.uniform1f(u.uDirX, ux); gl.uniform1f(u.uDirY, uy);
    gl.uniform1f(u.uSideSign, 1);
    gl.uniform1f(u.uLength, len); gl.uniform1f(u.uHalfWidth, half);
    gl.uniform1f(u.uColorR, color[0]); gl.uniform1f(u.uColorG, color[1]); gl.uniform1f(u.uColorB, color[2]);
    this._quad(this._rect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    this._bindPos(this.wall);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // wall_contact overlay: A,B screen px centre line, intensity 0..1, wall colour.
  drawWallContact(W, H, t, A, B, half, color, intensity) {
    const gl = this.gl;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy * half, py = ux * half;
    const b = this._bandBounds(A, B, px, py);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const side of [1, -1]) {
      this._use(this.contact);
      this._identityTilt(this.contact);
      const u = this.contact.u;
      gl.uniform1f(u.uCenterX, A.x); gl.uniform1f(u.uCenterY, A.y);
      gl.uniform1f(u.uDirX, ux); gl.uniform1f(u.uDirY, uy);
      gl.uniform1f(u.uSideSign, side);
      gl.uniform1f(u.uLength, len); gl.uniform1f(u.uHalfWidth, half);
      gl.uniform1f(u.uTime, t);
      gl.uniform1f(u.uColorR, color[0] * intensity);
      gl.uniform1f(u.uColorG, color[1] * intensity);
      gl.uniform1f(u.uColorB, color[2] * intensity);
      this._quad(this._rect(b.x0, b.y0, b.x1, b.y1));
      this._bindPos(this.contact);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  // Finish line checker: A,B screen px along the line, half = screen half-thickness.
  // `zoom` scales the shader's checker so cells are 8 world units (the game's
  // finish_line_grid.frag uses a floor(l/8.0) grid) rather than 8 screen px.
  drawFinish(W, H, t, A, B, half, zoom = 1) {
    const gl = this.gl;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy * half, py = ux * half;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.finish);
    gl.uniform2f(this.finish.u.uStart, A.x, A.y);
    gl.uniform2f(this.finish.u.uDir, ux / zoom, uy / zoom);
    // Newer engine builds expose the checker's peak brightness as a uniform
    // (older ones hardcoded 0.95); keep the same look.
    if (this.finish.u.uBrightness) gl.uniform1f(this.finish.u.uBrightness, 0.95);
    this._quad([
      { x: A.x + px, y: A.y + py }, { x: B.x + px, y: B.y + py },
      { x: A.x - px, y: A.y - py }, { x: B.x - px, y: B.y - py }]);
    this._bindPos(this.finish);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Portal particle band: A,B screen px along the segment.
  drawPortal(W, H, t, A, B, camZoom, halfWidthWorld, colorA, colorB, seed) {
    const gl = this.gl;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const ax = dx / len, ay = dy / len;         // along basis
    const px = -ay, py = ax;                     // across basis
    const hw = halfWidthWorld * camZoom;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._use(this.portal);
    const u = this.portal.u;
    gl.uniform2f(u.uOrigin, A.x, A.y);
    gl.uniform1f(u.uScale, camZoom);
    gl.uniform2f(u.uAlongBasis, ax, ay);
    gl.uniform2f(u.uAcrossBasis, px, py);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uHalfWidth, halfWidthWorld);
    gl.uniform1f(u.uLength, len / camZoom);
    gl.uniform1f(u.uSeed, seed);
    gl.uniform1f(u.uColorAR, colorA[0]); gl.uniform1f(u.uColorAG, colorA[1]); gl.uniform1f(u.uColorAB, colorA[2]);
    gl.uniform1f(u.uColorBR, colorB[0]); gl.uniform1f(u.uColorBG, colorB[1]); gl.uniform1f(u.uColorBB, colorB[2]);
    this._quad([
      { x: A.x - px * hw, y: A.y - py * hw }, { x: B.x - px * hw, y: B.y - py * hw },
      { x: A.x + px * hw, y: A.y + py * hw }, { x: B.x + px * hw, y: B.y + py * hw }]);
    this._bindPos(this.portal);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Thrust: origin screen px, unit dir (screen), length/halfWidth screen px.
  drawThrust(W, H, t, skin, ox, oy, dx, dy, length, halfWidth, color, alpha) {
    const gl = this.gl;
    const prog = this.thrust[skin] || this.thrust.default;
    const ex = ox + dx * length, ey = oy + dy * length;
    const px = -dy * halfWidth, py = dx * halfWidth;
    const { bx, by } = this._thrustBasis(dx, dy, length, halfWidth);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._use(prog);
    this._identityTilt(prog);
    const u = prog.u;
    gl.uniform2f(u.uOrigin, ox, oy);
    gl.uniform2f(u.uBasisX, bx[0], bx[1]);
    gl.uniform2f(u.uBasisY, by[0], by[1]);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uThrustColorR, color[0]); gl.uniform1f(u.uThrustColorG, color[1]); gl.uniform1f(u.uThrustColorB, color[2]);
    gl.uniform1f(u.uAlphaMultiplier, alpha);
    if (u.uHasImage) gl.uniform1f(u.uHasImage, 0);
    if (u.uImage) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.blank);
      gl.uniform1i(u.uImage, 0);
    }
    this._quad([
      { x: ox - px, y: oy - py }, { x: ex - px, y: ey - py },
      { x: ox + px, y: oy + py }, { x: ex + px, y: ey + py }]);
    this._bindPos(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawSprite(key, image, W, H, cx, cy, half, angle = 0, alpha = 1, tint = [1, 1, 1]) {
    const gl = this.gl; const tex = this.texture(key, image);
    const p = this.sprite;
    this._use(p);
    gl.uniform1f(p.u.uAlpha, alpha);
    gl.uniform3f(p.u.uTint, tint[0], tint[1], tint[2]);
    gl.uniform4f(p.u.uRot, Math.cos(angle), Math.sin(angle), cx, cy);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.uTex, 0);
    this._quad([
      { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
      { x: cx - half, y: cy + half }, { x: cx + half, y: cy + half }], true);
    gl.enableVertexAttribArray(p.a.aPos); gl.vertexAttribPointer(p.a.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(p.a.aUV); gl.vertexAttribPointer(p.a.aUV, 2, gl.FLOAT, false, 16, 8);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // The arrow trail, rendered exactly as the game does: a WORLD-SPACE triangle
  // mesh whose vertices carry `path_position` = (distance along the path,
  // lateral offset). The MVP maps world -> clip so the per-style fragment
  // programs can use screen-space derivatives (fwidth) and a 1px AA. `pts` are
  // world-space {x,y} samples, newest last; `arrow` is the live arrow pose so
  // styles can fade the ribbon under the arrow (uArrow = [x, y, enabled]).
  drawTrail(style, pts, cam, W, H, opt = {}) {
    const gl = this.gl;
    const prog = this.trail[style] || this.trail.ribbon;
    if (!prog || !pts || pts.length < 2) return;
    const radius = opt.radius ?? 16;
    const alpha = opt.alpha ?? 1;
    const color = opt.color ?? [1, 1, 1];
    const arrow = opt.arrow;

    // Cumulative arc length along the (polyline) centreline.
    const n = pts.length;
    const along = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      along[i] = along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const length = along[n - 1];
    if (length <= 1e-3) return;

    const hw = radius * 0.9;
    const verts = new Float32Array(n * 4 * 5);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const prev = pts[i - 1] || pts[i], next = pts[i + 1] || pts[i];
      let dx = next.x - prev.x, dy = next.y - prev.y;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const nx = -dy, ny = dx;                       // left normal
      const x = pts[i].x, y = pts[i].y, a = along[i];
      // triangle strip (2 verts per sample, drawn as triangles below)
      verts[o++] = x - nx * hw; verts[o++] = y - ny * hw; verts[o++] = 0; verts[o++] = a; verts[o++] = -hw;
      verts[o++] = x + nx * hw; verts[o++] = y + ny * hw; verts[o++] = 0; verts[o++] = a; verts[o++] = hw;
    }
    // Expand the strip into triangles.
    const tris = new Float32Array((n - 1) * 6 * 5);
    let p = 0;
    for (let i = 0; i < n - 1; i++) {
      const b0 = i * 10, b1 = (i + 1) * 10;
      tris.set(verts.subarray(b0, b0 + 5), p); p += 5;
      tris.set(verts.subarray(b1, b1 + 5), p); p += 5;
      tris.set(verts.subarray(b0 + 5, b0 + 10), p); p += 5;
      tris.set(verts.subarray(b0 + 5, b0 + 10), p); p += 5;
      tris.set(verts.subarray(b1, b1 + 5), p); p += 5;
      tris.set(verts.subarray(b1 + 5, b1 + 10), p); p += 5;
    }

    // MVP: world -> screen (top-left, y down) -> clip (y up). Matches `project`.
    const z = cam.zoom;
    const mvp = new Float32Array([
      z / W * 2, 0, 0, 0,
      0, -z / H * 2, 0, 0,
      0, 0, 1, 0,
      -cam.x * z / W * 2, cam.y * z / H * 2, 0, 1,
    ]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);           // the styles write gl_FragDepth; keep it out of the buffer
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.uMvp, false, mvp);
    if (prog.u.uRes) gl.uniform2f(prog.u.uRes, W, H);
    gl.uniform4f(prog.u.uColor, color[0], color[1], color[2], 1);
    gl.uniform4f(prog.u.uMetrics, 0, radius, length, hw);
    gl.uniform4f(prog.u.uAppearance, alpha, 0, 0, 0);
    gl.uniform4f(prog.u.uArrow, arrow ? arrow.x : 0, arrow ? arrow.y : 0, arrow ? 1 : 0, 0);
    if (prog.u.uImage) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.trailWhite);
      gl.uniform1i(prog.u.uImage, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailMesh);
    gl.bufferData(gl.ARRAY_BUFFER, tris, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(prog.a.position);
    gl.vertexAttribPointer(prog.a.position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(prog.a.path_position);
    gl.vertexAttribPointer(prog.a.path_position, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, (n - 1) * 6);
  }
}

export const BACKGROUNDS = ['grid', 'dots', 'circles', 'squares', 'none'];

import { FRAME_DRAG_K } from './event-horizon-physics.mjs';

export const quadVertexShader = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* ---------------------------------------------------------------------
   The ray marcher. For every pixel we shoot a light ray *backward* from
   the camera and bend it with the exact Schwarzschild photon equation.

   Trick: the orbit equation d²u/dφ² + u = (3/2)·r_s·u²  (u = 1/r) is what
   a Newtonian particle would follow under the central acceleration
        a = -(3/2) · h² · x / r⁵ ,   h = |x × v|
   so we can integrate in ordinary 3D Cartesian coordinates and still get
   the exact light path shape for a non-rotating black hole.
   --------------------------------------------------------------------- */
export const blackHoleFragmentShader = /* glsl */`
  precision highp float;

  #define PI 3.14159265359
  #define MAX_STEPS 600
  #define ESCAPE_R 60.0        // beyond this the ray is "at infinity"
  #define STREAM_OUT 55.0      // gas stream fades out by this radius
  #define FLOW_T 24.0          // length of one turbulence cross-fade cycle
  #define FLOW_T0 6.0          // pre-shear so the gas always looks wound up
  #define FRAME_DRAG_K ${FRAME_DRAG_K.toFixed(2)}
  #define MAX_PROBES 4

  uniform vec2  uResolution;
  uniform vec3  uCamPos, uCamRight, uCamUp, uCamFwd;
  uniform float uTanHalfFov;
  uniform float uTime;         // simulation time in units of r_s / c
  uniform int   uSteps;
  uniform float uSpin;         // dimensionless spin a (0 … 0.99)
  uniform float uHorizon;      // capture radius
  uniform float uIsco;         // inner edge of the stable disk
  uniform float uDiskOuter;
  uniform vec3  uDiskN, uDiskE1, uDiskE2;   // disk normal and two in-plane axes
  uniform float uObsLapse;     // sqrt(1 - r_s/r) at the shuttle
  uniform float uSkyBoost;     // blueshift brightening of starlight for a hovering observer
  uniform vec3  uStarDir;
  uniform float uStarAng;
  uniform float uStarPhi;
  uniform float uLensing, uDoppler, uDisk, uStar, uStream;
  uniform vec4  uProbes[MAX_PROBES];        // xyz = position, w = brightness
  uniform vec3  uProbeCol[MAX_PROBES];
  uniform int   uProbeCount;

  // ---------- hashes & value noise (no textures anywhere) ----------
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3  hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
  float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

  float vnoise2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
               mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    float a = .5, s = 0.;
    for (int i = 0; i < 5; i++) { s += a * vnoise2(p); p = p * 2.03 + vec2(17.3, 9.1); a *= .5; }
    return s;
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float a = .5, s = 0.;
    for (int i = 0; i < 5; i++) { s += a * vnoise3(p); p = p * 2.02 + vec3(5.1, 1.7, 8.3); a *= .5; }
    return s;
  }

  // ---------- blackbody colour (Kelvin → linear RGB, brightest channel ≈ 1) ----------
  vec3 blackbody(float T) {
    float t = clamp(T, 800., 40000.) / 100.;
    float r, g, b;
    if (t <= 66.) { r = 1.; g = clamp(0.39008157876 * log(t) - 0.63184144378, 0., 1.); }
    else { r = clamp(1.29293618606 * pow(t - 60., -0.1332047592), 0., 1.);
           g = clamp(1.12989086089 * pow(t - 60., -0.0755148492), 0., 1.); }
    if (t >= 66.) b = 1.; else if (t <= 19.) b = 0.;
    else b = clamp(0.54320678911 * log(t - 10.) - 1.19625408914, 0., 1.);
    return pow(vec3(r, g, b), vec3(2.2));
  }

  // ---------- sky: stars, Milky Way, companion star ----------
  const vec3 GAL_N = vec3(0.501, 0.852, 0.150);    // normal of the galactic plane
  const vec3 GAL_C = vec3(0.587, -0.207, -0.783);  // direction of the galactic centre

  // One layer of stars: space is cut into cubes and some cubes hold a star.
  vec3 starLayer(vec3 d, float scale, float chance, float rad, float bright) {
    vec3 p = d * scale, id = floor(p), f = p - id;
    vec3 rnd = hash33(id);
    if (rnd.x > chance) return vec3(0.);
    vec3 sp = 0.3 + 0.4 * hash33(id + 71.7);
    float core = smoothstep(rad, 0., length(f - sp));
    float mag = (0.08 + pow(rnd.y, 5.)) * bright;
    return blackbody(mix(3200., 16000., rnd.z * rnd.z)) * core * core * mag;
  }

  vec3 sky(vec3 d) {
    // Milky Way band with dust lanes
    float sinLat = dot(d, GAL_N);
    float band = exp(-sinLat * sinLat / 0.045);
    float toC = dot(d, GAL_C) * .5 + .5;
    float clouds = fbm3(d * 3.5 + 11.);
    float dust = smoothstep(0.42, 0.72, fbm3(d * 7. + vec3(3., -5., 8.))) * exp(-sinLat * sinLat / 0.012);
    vec3 mw = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.82, 0.6), pow(toC, 3.));
    mw *= band * (0.3 + 1.3 * clouds * clouds) * (0.3 + 1.4 * toC * toC) * (1. - 0.85 * dust);
    vec3 col = mw * 0.10;

    // Three star layers, denser inside the band
    float dens = 1. + 2.5 * band * (1. - dust);
    col += starLayer(d, 38., 0.05 * dens, 0.12, 5.0);
    col += starLayer(d, 85., 0.10 * dens, 0.20, 1.6);
    col += starLayer(d, 170., 0.16 * dens, 0.28, 0.5);

    // Companion blue supergiant: limb-darkened disc plus a soft corona
    if (uStar > .5) {
      float ang = acos(clamp(dot(d, uStarDir), -1., 1.));
      vec3 sc = vec3(0.55, 0.70, 1.0);
      if (ang < uStarAng) {
        float mu = sqrt(1. - ang * ang / (uStarAng * uStarAng));
        float gran = 0.88 + 0.24 * fbm3(d * 70.);
        col = sc * 9. * (0.35 + 0.65 * mu) * gran;
      } else {
        float x = (ang - uStarAng) / uStarAng;
        col += sc * 9. * (0.22 * exp(-x * 9.) + 0.008 / (1. + x * x * 8.));
      }
    }
    return col * uSkyBoost;
  }

  // ---------- photon acceleration ----------
  vec3 accel(vec3 p, vec3 v) {
    if (uLensing < .5) return vec3(0.);
    float r2 = dot(p, p), r = sqrt(r2);
    vec3 h = cross(p, v);
    vec3 a = -1.5 * dot(h, h) * p / (r2 * r2 * r);          // exact Schwarzschild bending
    if (uSpin > 0.) {
      // APPROXIMATION of Kerr frame dragging: a weak-field gravitomagnetic
      // (Lense–Thirring) force. Light moving with the spin can skim closer
      // than light moving against it, which makes the shadow lopsided.
      vec3 xh = p / r;
      vec3 B = (3. * dot(uDiskN, xh) * xh - uDiskN) / (r2 * r);
      a += uSpin * FRAME_DRAG_K * cross(v, B);
    }
    return a;
  }

  // ---------- frequency shift g = ν_observed / ν_emitted for orbiting gas ----------
  // p: emission point, r: its radius, rayDir: direction of the backward-traced ray there.
  float redshiftG(vec3 p, float r, vec3 rayDir) {
    float rr = max(r, 1.0005);
    vec3 rhat = p / r;
    vec3 dl = rayDir;
    float grav = 1.;
    if (uLensing > .5) {
      float lapse = sqrt(1. - 1. / rr);
      grav = lapse / uObsLapse;                              // gravitational redshift
      float dr = dot(rayDir, rhat);
      dl = normalize(rhat * dr / lapse + (rayDir - dr * rhat));  // direction in the local static frame
    }
    float D = 1.;
    if (uDoppler > .5) {
      float beta = min(sqrt(0.5 / max(rr - 1., 1e-3)), 0.75);   // orbital speed seen by a static observer
      vec3 tang = normalize(cross(uDiskN, rhat));               // prograde direction
      D = sqrt(1. - beta * beta) / (1. - beta * dot(tang, -dl)); // relativistic Doppler factor
    }
    return grav * D;
  }

  // Thin-disk flux profile (Novikov–Thorne shape, slightly softened at the
  // inner edge), normalised so its peak is ≈ 1. Inside the ISCO the gas
  // plunges and its emission falls away toward the horizon.
  float diskFlux(float r) {
    if (r >= uIsco) { float s = sqrt(uIsco / r); float s3 = s * s * s; return s3 * s3 * (1. - 0.9 * s) / 0.107; }
    return 0.93 * pow(clamp((r - 1.) / (uIsco - 1.), 0., 1.), 1.5);
  }

  float diskNoise(float r, float ang, float seed) {
    vec2 q = r * vec2(cos(ang), sin(ang));
    return fbm2(q * 1.6 + seed);
  }

  // ---------- accretion disk + gas stream, evaluated where a ray pierces the disk plane ----------
  // Returns emitted light (rgb) and opacity (a).
  vec4 shadeDisk(vec3 hit, float r, vec3 rayDir) {
    float phi = atan(dot(hit, uDiskE2), dot(hit, uDiskE1));
    float g = redshiftG(hit, r, rayDir);
    float g4 = g * g * g * g;                   // beaming: observed intensity ∝ g⁴
    vec3 emis = vec3(0.); float alpha = 0.;

    if (uDisk > .5 && r < uDiskOuter) {
      float rr = max(r, 1.02);
      float omega = sqrt(0.5 / (rr * rr * rr));  // Keplerian angular velocity

      // Turbulence carried round at the local orbital speed. Differential
      // rotation would shear any pattern into mush, so two copies with
      // staggered clocks are cross-faded (a "flow map").
      float cyc = uTime / FLOW_T;
      float p1 = fract(cyc), p2 = fract(cyc + .5);
      float w1 = 1. - abs(2. * p1 - 1.);
      float n1 = diskNoise(r, phi - omega * (FLOW_T0 + p1 * FLOW_T), floor(cyc) * 13.7);
      float n2 = diskNoise(r, phi - omega * (FLOW_T0 + p2 * FLOW_T), floor(cyc + .5) * 13.7 + 37.);
      float n = mix(n2, n1, w1);
      float rings = (0.55 + 0.45 * vnoise2(vec2(r * 3.5, 0.5))) * (0.75 + 0.25 * vnoise2(vec2(r * 11., 3.)));
      float density = (0.22 + 0.78 * smoothstep(0.32, 0.68, n)) * rings;

      float outerFade = 1. - smoothstep(uDiskOuter * 0.7, uDiskOuter, r);
      float flux = diskFlux(r);
      // T ∝ flux^(1/4) (≈ r^-3/4 far out). Real temperatures here are millions
      // of kelvin (X-rays); they are scaled into the visible range.
      float Tn = r >= uIsco ? pow(max(flux, 1e-4), 0.25) : 0.98;
      float I = 0.3 * pow(flux, 0.8) * density * outerFade * g4;
      emis = blackbody(5600. * Tn * g) * I;
      alpha = clamp(density * outerFade * 1.6, 0., 1.) * mix(0.3, 1., smoothstep(uIsco * 0.8, uIsco, r));
    }

    // Gas stream from the companion: a ribbon in the orbital plane that
    // curves forward (prograde) and splashes into the disk's outer rim.
    if (uStream > .5 && r > uDiskOuter * 0.6) {
      float wind = pow(uDiskOuter / r, 1.3);
      float dphi = mod(phi - (uStarPhi + 1.3 * wind) + PI, 2. * PI) - PI;
      float slope = 1.69 * wind;
      float perp = r * abs(dphi) / sqrt(1. + slope * slope);
      float w = 0.3 + 0.03 * r;
      float dens = exp(-perp * perp / (w * w));
      dens *= smoothstep(uDiskOuter * 0.6, uDiskOuter * 0.95, r) * (1. - smoothstep(STREAM_OUT * 0.5, STREAM_OUT, r));
      float flow = 0.55 + 0.45 * vnoise2(vec2(r * 1.2 + uTime * 0.25, perp * 3.));
      float hot = exp(-pow((r - uDiskOuter) / 1.5, 2.));          // impact hot spot
      vec3 sc = mix(vec3(1.0, 0.55, 0.35), vec3(0.75, 0.85, 1.0), hot * 0.8);
      emis += sc * dens * flow * (0.5 + 2.5 * hot) * 1.2 * g4;
      alpha = 1. - (1. - alpha) * (1. - dens * 0.6);
    }
    return vec4(emis, alpha);
  }

  void main() {
    // Camera ray for this pixel
    vec2 uv = gl_FragCoord.xy / uResolution * 2. - 1.;
    uv.x *= uResolution.x / uResolution.y;
    vec3 dir = normalize(uCamFwd + uTanHalfFov * (uv.x * uCamRight + uv.y * uCamUp));
    vec3 pos = uCamPos;

    // The shuttle hovers (a "static observer"). Its local sense of direction
    // differs from the coordinate direction: radial distances are stretched.
    if (uLensing > .5) {
      float r0 = length(pos); vec3 rhat = pos / r0;
      float dr = dot(dir, rhat);
      dir = normalize(rhat * dr * sqrt(1. - 1. / r0) + (dir - dr * rhat));
    }

    vec3 vel = dir;
    vec3 col = vec3(0.);
    float trans = 1.;                 // how much light from further back still gets through
    float hPrev = dot(pos, uDiskN);   // signed height above the disk plane
    bool captured = false, escaped = false;

    float probeDist[MAX_PROBES]; float probeTrans[MAX_PROBES];
    for (int k = 0; k < MAX_PROBES; k++) { probeDist[k] = 1e9; probeTrans[k] = 0.; }

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= uSteps) break;
      float r = length(pos);
      if (r < uHorizon) { captured = true; break; }                       // fell through the horizon
      if (r > ESCAPE_R && dot(pos, vel) > 0.) { escaped = true; break; }  // off to infinity
      if (trans < 0.01) break;                                            // hidden behind opaque gas

      // Adaptive step: small near the hole, large far away. Velocity-Verlet.
      float dt = max(0.1 * r / length(vel), 0.01);
      vec3 vh = vel + accel(pos, vel) * (0.5 * dt);
      vec3 np = pos + vh * dt;
      vec3 nv = vh + accel(np, vh) * (0.5 * dt);
      float hNew = dot(np, uDiskN);

      // Thin glowing "atmosphere" above and below the disk, integrated
      // analytically along this step so it never bands.
      if (uDisk > .5 && r > uIsco * 0.8 && r < uDiskOuter) {
        float H = 0.035 * r + 0.01;
        float a0 = abs(hPrev), a1 = abs(hNew);
        if (min(a0, a1) < 6. * H) {
          float e0 = exp(-a0 / H), e1 = exp(-a1 / H);
          float integ = hPrev * hNew < 0. ? H * (2. - e0 - e1) / max(a0 + a1, 1e-5)
                      : (abs(a0 - a1) < 1e-4 ? e0 : H * abs(e0 - e1) / abs(a0 - a1));
          float f = diskFlux(r) * smoothstep(uIsco * 0.8, uIsco * 1.1, r) * (1. - smoothstep(uDiskOuter * 0.7, uDiskOuter, r));
          float g = redshiftG(pos, r, vel);
          col += trans * blackbody(5600. * pow(max(f, 1e-4), 0.25) * g) * f * g * g * g * g * integ * length(np - pos) * 0.05;
        }
      }

      // Did this step cross the disk plane?
      if (hPrev * hNew < 0.) {
        float f = hPrev / (hPrev - hNew);
        vec3 hit = mix(pos, np, f);
        float rh = length(hit);
        if (rh > 1. && rh < ESCAPE_R) {
          vec4 d = shadeDisk(hit, rh, normalize(mix(vel, nv, f)));
          col += trans * d.rgb;
          trans *= 1. - d.a;
        }
      }

      // Probes: remember how close this (bent) ray passes to each one.
      for (int k = 0; k < MAX_PROBES; k++) {
        if (k >= uProbeCount) break;
        vec3 ab = np - pos;
        float t = clamp(dot(uProbes[k].xyz - pos, ab) / dot(ab, ab), 0., 1.);
        float dd = length(uProbes[k].xyz - (pos + ab * t));
        if (dd < probeDist[k]) { probeDist[k] = dd; probeTrans[k] = trans; }
      }

      pos = np; vel = nv; hPrev = hNew;
    }

    // Rays that got away show the sky in the direction they finally point.
    // Rays that ran out of steps were circling the photon sphere: black.
    if (escaped && !captured) col += trans * sky(normalize(vel));

    for (int k = 0; k < MAX_PROBES; k++) {
      if (k >= uProbeCount) break;
      float s = 0.05, q = s * s / (probeDist[k] * probeDist[k] + s * s);
      col += uProbeCol[k] * uProbes[k].w * probeTrans[k] * (q * sqrt(q) + 0.02 * q);
    }

    gl_FragColor = vec4(col, 1.);
  }
`;

/* Final pass: chromatic aberration toward the frame edges, exposure,
   ACES filmic tone mapping, sRGB encoding, and film grain. */
export const finalPassShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uTime:     { value: 0 },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uExposure; varying vec2 vUv;
    // ACES filmic curve (Narkowicz fit)
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0., 1.); }
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5; float d2 = dot(c, c);
      vec2 off = c * d2 * 0.012;                       // grows toward the corners
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= uExposure * (1. - 0.5 * d2);              // gentle vignette
      col = pow(aces(col), vec3(1. / 2.2));
      col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.035;   // film grain
      gl_FragColor = vec4(col, 1.);
    }
  `,
};

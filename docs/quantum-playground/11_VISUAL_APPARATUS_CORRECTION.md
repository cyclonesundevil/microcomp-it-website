# Post-Phase-10 Visual Apparatus Correction

## Scope

This correction is limited to Canvas apparatus geometry and illustrative emission motion. It does not change an approved numerical physics engine, probability distribution, Monte Carlo sampler, Bell model, candidate mechanism, or numerical reference fixture.

## User-Visible Defects

### Disconnected emission origin

The former emission cue was an absolutely positioned DOM element. Its `top`, `left`, and fixed horizontal keyframe were unrelated to the Canvas source, detector, or sampled detector bin. On a responsive layout it could appear to start near the plotted probability curve rather than at the source.

### Static slit apparatus

The former barrier used fixed fractions of the Canvas height for both aperture width and separation. The numerical controls correctly rebuilt the physics distribution, but `a`, `d`, and `L` did not meaningfully alter the visible apparatus.

## Corrections

### One apparatus-coordinate calculation

`frontend/quantum-apparatus-geometry.mjs` now provides the pure rendering calculations used by:

- source rendering;
- barrier and aperture rendering;
- detector rendering;
- sampled-bin-to-detector mapping;
- screen-distance indicator;
- responsive resize;
- Single Particle propagation cues;
- symmetric slit wavefront cues.

The controller no longer defines separate source, slit-opening, detector, or DOM-pulse coordinates. Every Canvas redraw recalculates geometry from the current viewport and the current `a`, `d`, and `L` controls.

### Schematic slit transform

The display intentionally is not a literal physical scale. Both slit width and center separation use the same monotonic transform

`T_H(u) = p_min(H) + [p_max(H) - p_min(H)] u / 100`,

where `H` is the current Canvas height, `p_min(H)=clamp(0.018H,6,10)` pixels, and `p_max(H)=clamp(0.24H,72,120)` pixels.

Therefore:

- `a₂>a₁ ⇒ T_H(a₂)>T_H(a₁)`;
- `d₂>d₁ ⇒ T_H(d₂)>T_H(d₁)`;
- because the same transform is used for both values, `d≥a ⇒ T_H(d)≥T_H(a)`;
- at `d=a`, the displayed apertures touch without overlap.

The Canvas labels the aperture width `a`, center separation `d`, and slit-to-screen indicator `L`. The controls and explanatory panel state: **“Apparatus geometry is schematic — not to scale.”**

### Screen distance

The detector moves horizontally over a bounded visual range as `L` changes:

`x_screen/W = 0.72 + 0.12 × (clamp(L,0.5,2.0)-0.5)/1.5`.

An explicit slit-to-screen bracket and current `L` label update at the same time. This is a schematic visual consequence; the Fraunhofer calculation remains authoritative.

### Sampled emission sequence

For an individual Single Particle event:

1. the numerical sampler selects the detector bin exactly as before;
2. the newest impact is temporarily withheld from the Canvas while the cue runs;
3. the source flashes at the exact authoritative source center;
4. the illustrative cue begins at that same coordinate and ends at `detectorPointForBin(sampledBin)`;
5. the pending impact is revealed and remains in the existing sampled observation display.

Reduced-motion mode skips the cue and displays the sampled impact immediately.

For slit experiments, the cue approaches the aperture plane and becomes symmetric wavefront motion at both displayed apertures. It never selects or depicts an electron choosing an upper or lower slit. Public text continues to identify propagation and wavefront motion as illustrative rather than an observed quantum trajectory.

## Automated Regression Tests

`tests/quantum-playground-apparatus.test.js` adds ten tests covering:

- exact equality of emission start and rendered source coordinates;
- exact sampled-bin endpoint mapping;
- monotonic slit separation;
- monotonic slit width;
- valid touching geometry at `d=a` and rejection of `d<a`;
- immediate fresh geometry from valid control changes;
- consistent responsive recomputation;
- monotonic detector/indicator movement with `L`;
- unchanged approved seeded Single Particle, Double Slit, polarization-singlet, and CHSH fixtures;
- symmetric slit animation with no selected path.

The focused Quantum Playground suite passes **125/125**. The approved numerical model files have an empty source diff from the Phase 10 deployment commit.

The complete Node suite passes **311/312**. Its only failure is the previously documented contact-analytics assertion expecting `"delivered"` rather than `"verified_delivered"`; no Quantum Playground file causes that failure.

## Browser Verification

Chromium verification covered Single Particle and Double Slit at 1440×1000 and 390×844.

- Single Particle source: `(97.560, 235.000)` CSS pixels.
- Emission start: exactly `(97.560, 235.000)`.
- Seeded sampled bin: `95`.
- Calculated detector endpoint: `(617.880, 270.250)`; the live animation data matched it exactly.
- Displayed slit width increased from `12.634 px` at `a=4 µm` to `39.762 px` at `a=30 µm`.
- At `d=a=30 µm`, displayed width and separation were both `39.762 px`.
- Displayed separation increased to `112.800 px` at `d=100 µm`.
- Detector x-position increased from `585.360 px` at `L=0.50 m` to `682.920 px` at `L=2.00 m`.
- Source x-position remained exactly `0.12` of the Canvas width on desktop and mobile after responsive recomputation.
- Mobile horizontal overflow was zero.
- No page error or failed apparatus/module request occurred.

Manual screenshot review confirmed that the Single Particle cue visibly originates at the source, the detector impact remains after arrival, slit controls visibly alter the barrier, the `L` bracket tracks the detector, and the Double Slit cue remains symmetric rather than choosing one aperture.

## Visual Evidence

The Phase 10 captures document the former static apparatus. Corrected captures are:

- `phase-11-single-emission-desktop.png` — source flash/propagation cue;
- `phase-11-single-desktop.png` — persistent sampled impact;
- `phase-11-double-wavefront-desktop.png` — symmetric aperture/wavefront cue;
- `phase-11-double-desktop.png` — corrected desktop apparatus;
- `phase-11-double-wavefront-mobile.png` — responsive mobile cue;
- `phase-11-double-mobile.png` — corrected mobile apparatus.

## Numerical Physics Confirmation

`frontend/quantum-playground-model.mjs` and `frontend/quantum-reality-model.mjs` were not modified. Existing normalization, interference, which-path, decoherence, eraser, entanglement, CHSH, Phase 8 candidate, and seeded Monte Carlo tests remain unchanged and passing. The new module maps already-calculated values into schematic pixels only.

## Incidental Regression Recovery

The repository-wide run exposed that Phase 10 deployment preparation had changed two sitemap release dates while the existing sitemap consistency test requires the established common date. Those two metadata dates were restored. This recovery does not affect the Quantum Playground runtime or any physics behavior. The only remaining repository-wide failure is the separately documented stale contact-analytics assertion.

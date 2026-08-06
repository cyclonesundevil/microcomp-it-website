/**
 * Rendering constants for the observationally inspired Black Hole Playground.
 * Kept free of Three.js so deterministic helpers and shader contracts can be
 * checked in Node without creating a WebGL context.
 */

export const BLACK_HOLE_PALETTE = Object.freeze({
    space: 0x010204,
    photon: 0xfff4d6,
    photonGlow: 0xffa94d,
    rayWarm: 0xffd6a1,
    rayNeutral: 0xf2f6ff,
    rayCool: 0xa9bfd8,
    grid: 0x8191a6
});

export const OBSERVER_ANGLE_MIN_DEGREES = 0;
export const OBSERVER_ANGLE_MAX_DEGREES = 120;

export function normalizeObserverAngle(angleDegrees) {
    const angle = Number(angleDegrees);
    if (!Number.isFinite(angle)) {
        throw new TypeError('angleDegrees must be a finite number');
    }
    return Math.min(1, Math.max(0, angle / OBSERVER_ANGLE_MAX_DEGREES));
}

export const BLACK_HOLE_MODES = Object.freeze({
    disk: Object.freeze({
        category: 'Observable appearance',
        title: 'Accretion disk',
        badge: 'Rendered approximation',
        description: 'A simplified view of hot orbiting material, Doppler asymmetry, the black-hole shadow, and secondary lensed disk images.',
        interaction: 'Drag horizontally to orbit. Drag vertically—or use Observer angle—to change inclination.',
        sceneLabel: 'Rotatable accretion disk approximation around a Kerr black hole',
        rotatable: true,
        legend: Object.freeze([
            Object.freeze({ marker: 'gravity', label: 'Doppler-brightened side' }),
            Object.freeze({ marker: 'plasma', label: 'receding, dimmer side' }),
            Object.freeze({ marker: 'dot', label: 'photon ring' }),
            Object.freeze({ marker: 'line', label: 'lensed disk image' })
        ])
    }),
    lensing: Object.freeze({
        category: 'Observable appearance',
        title: 'Lensing view',
        badge: 'Fixed observer frame',
        description: 'A screen-space approximation showing how a compact object remaps a deterministic stellar background around an Einstein-scale ring.',
        interaction: 'This view uses a fixed frame. Adjust mass and spin to compare distortion strength.',
        sceneLabel: 'Fixed-frame gravitational lensing approximation with distorted star field',
        rotatable: false,
        legend: Object.freeze([
            Object.freeze({ marker: 'starfield', label: 'unlensed star field' }),
            Object.freeze({ marker: 'ring', label: 'Einstein-scale ring' }),
            Object.freeze({ marker: 'ray', label: 'illustrative deflected ray' }),
            Object.freeze({ marker: 'shadow', label: 'black-hole shadow' })
        ])
    }),
    wave: Object.freeze({
        category: 'Conceptual diagram',
        title: 'Wave-optics diagram',
        badge: 'Teaching abstraction',
        description: 'A conceptual view of propagating wavefronts, path interference, and caustic structure near a compact lens.',
        interaction: 'Drag to rotate the teaching diagram and inspect the wavefronts, paths, and caustic structure from different angles.',
        sceneLabel: 'Rotatable conceptual wave-optics diagram near a compact gravitational lens',
        rotatable: true,
        legend: Object.freeze([
            Object.freeze({ marker: 'wave', label: 'wavefront' }),
            Object.freeze({ marker: 'ray', label: 'propagation path' }),
            Object.freeze({ marker: 'caustic', label: 'caustic structure' }),
            Object.freeze({ marker: 'shadow', label: 'central lens' })
        ])
    }),
    well: Object.freeze({
        category: 'Conceptual diagram',
        title: 'Spacetime-well diagram',
        badge: 'Embedding analogy',
        description: 'A two-dimensional embedding analogy for spatial curvature. It is not the literal shape of spacetime or a physical funnel.',
        interaction: 'Drag to inspect the grid. Reset view restores the standard teaching perspective.',
        sceneLabel: 'Rotatable conceptual embedding diagram of spatial curvature',
        rotatable: true,
        legend: Object.freeze([
            Object.freeze({ marker: 'grid', label: 'curvature grid' }),
            Object.freeze({ marker: 'ring', label: 'horizon reference' }),
            Object.freeze({ marker: 'orbit', label: 'reference orbit' }),
            Object.freeze({ marker: 'axis', label: 'spin-axis guide' })
        ])
    })
});

export function createSeededRandom(seed = 0x5f3759df) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

export function getBlackHoleRenderProfile({
    width = 1280,
    devicePixelRatio = 1,
    reducedMotion = false
} = {}) {
    const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 1280;
    const safePixelRatio = Number.isFinite(devicePixelRatio)
        ? Math.max(1, devicePixelRatio)
        : 1;
    const compact = safeWidth < 700;

    return Object.freeze({
        compact,
        pixelRatio: Math.min(
            safePixelRatio,
            reducedMotion ? 1 : (compact ? 1.25 : 1.75)
        ),
        maximumFramesPerSecond: reducedMotion ? 0 : (compact ? 30 : 60)
    });
}

export const ACCRETION_DISK_VERTEX_SHADER = `
varying vec2 vDiskPosition;

void main() {
    vDiskPosition = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RELATIVISTIC_DISK_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/*
 * Fast screen-space approximation of the image produced by null-geodesic
 * tracing around a Kerr black hole.  The direct equatorial image, primary
 * lensed image, secondary image and exponentially compressed photon
 * sub-rings are evaluated together so their silhouettes remain coherent.
 */
export const RELATIVISTIC_DISK_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform float uSpin;
uniform float uInclination;
uniform float uDoppler;
uniform float uAzimuth;
uniform float uInnerRadius;

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.17);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
        f.y
    );
}

float lineGlow(float distanceToLine, float width) {
    return exp(-pow(distanceToLine / max(width, 0.0005), 2.0));
}

vec3 thermalColor(float heat) {
    vec3 deepRed = vec3(0.16, 0.0015, 0.0);
    vec3 red = vec3(0.92, 0.018, 0.001);
    vec3 orange = vec3(1.0, 0.20, 0.005);
    vec3 gold = vec3(1.0, 0.58, 0.055);
    vec3 color = mix(deepRed, red, smoothstep(0.02, 0.28, heat));
    color = mix(color, orange, smoothstep(0.22, 0.62, heat));
    return mix(color, gold, smoothstep(0.66, 1.0, heat));
}

void main() {
    float inclination = clamp(uInclination, 0.0, 1.0);
    float observerAngle = inclination * 2.09439510239;
    float observerSide = cos(observerAngle) < 0.0 ? -1.0 : 1.0;
    float edge = pow(max(sin(observerAngle), 0.0), 1.55);
    float higherOrderVisibility = smoothstep(0.72, 0.97, edge);
    // Deliberate overscan keeps every lensed image inside the shader plane.
    // A wider face-on coordinate span also cancels the rectangular plane's
    // aspect ratio, while preserving the desired width near edge-on.
    float horizontalSpan = mix(6.72, 4.5, edge);
    vec2 p = (vUv - 0.5) * vec2(horizontalSpan, 3.8);
    float viewCos = cos(uAzimuth);
    float viewSin = sin(uAzimuth);
    p = mat2(viewCos, -viewSin, viewSin, viewCos) * p;
    p.y *= observerSide;
    float projectedHeight = mix(0.78, 0.055, edge);
    float phase = uTime * (0.08 + uSpin * 0.15);

    float azimuth = atan(p.y / max(projectedHeight, 0.025), p.x);
    float directRadius = length(vec2(p.x, p.y / max(projectedHeight, 0.025)));
    float directWindow = smoothstep(uInnerRadius, uInnerRadius + 0.05, directRadius)
        * (1.0 - smoothstep(1.67, 1.82, directRadius));
    float directTexture = 0.58
        + 0.24 * noise(vec2(directRadius * 31.0, azimuth * 8.0 - phase))
        + 0.18 * sin(directRadius * 115.0 - azimuth * 9.0 + phase * 8.0);
    directTexture = clamp(directTexture, 0.08, 1.0);
    float directHeat = directWindow
        * pow(clamp(
            1.0 - (directRadius - uInnerRadius) / (1.82 - uInnerRadius),
            0.0,
            1.0
        ), 0.58)
        * directTexture;

    // The primary image of the far side: nested arches compressed toward the
    // critical curve. Frame dragging shifts the curve slightly with spin.
    float spinShift = uSpin * 0.16;
    float upperY = p.y + 0.015;
    float upperRadius = length(vec2(
        (p.x - spinShift) / 1.0,
        upperY / mix(0.78, 0.96, edge)
    ));
    float upperMask = smoothstep(-0.035, 0.025, upperY)
        * (1.0 - smoothstep(1.62, 1.78, upperRadius))
        * smoothstep(0.48, 0.535, upperRadius);
    float upperAngle = atan(
        upperY / mix(0.78, 0.96, edge),
        p.x - spinShift
    );
    float upperDistortion = noise(vec2(
        upperRadius * 18.0 - phase * 0.7,
        upperAngle * 4.0 + phase
    ));
    float upperBands = 0.11
        + 0.48 * pow(0.5 + 0.5 * sin(
            upperRadius * 49.0
                + upperDistortion * 1.35
                + sin(upperAngle * 7.0 - phase) * 0.34
        ), 5.0)
        + 0.18 * pow(0.5 + 0.5 * sin(upperRadius * 101.0), 9.0);
    float upperHeat = upperMask
        * pow(clamp(1.78 - upperRadius, 0.0, 1.25), 0.42)
        * upperBands * higherOrderVisibility;

    // First underside image. It is dimmer and vertically compressed, as a
    // geodesic tracer shows for a nearly edge-on optically thin disk.
    vec2 lowerCenter = vec2(p.x + spinShift * 0.45, p.y + 0.31);
    float lowerRadius = length(vec2(lowerCenter.x / 0.73, lowerCenter.y / 0.43));
    float lowerMask = smoothstep(0.48, 0.515, lowerRadius)
        * (1.0 - smoothstep(0.94, 1.04, lowerRadius))
        * (1.0 - smoothstep(0.055, 0.12, p.y));
    float lowerBands = 0.075
        + 0.42 * pow(0.5 + 0.5 * sin(
            lowerRadius * 51.0 - phase * 2.0
        ), 6.0)
        + 0.14 * pow(0.5 + 0.5 * sin(lowerRadius * 105.0), 10.0);
    float lowerHeat = lowerMask
        * pow(clamp(1.08 - lowerRadius, 0.0, 0.58), 0.32)
        * lowerBands * higherOrderVisibility;

    // Successive photon sub-rings accumulate exponentially close to the
    // critical curve instead of appearing as one arbitrary torus.
    float criticalX = 0.59 - uSpin * 0.10;
    float critical = length(vec2((p.x - spinShift) / criticalX, p.y / 0.62));
    float photon = lineGlow(abs(critical - 1.0), 0.012);
    photon += lineGlow(abs(critical - 1.035), 0.007) * 0.48;
    photon += lineGlow(abs(critical - 1.052), 0.004) * 0.25;
    photon *= mix(0.38, 1.0, higherOrderVisibility);
    photon *= 1.0 - smoothstep(0.87, 1.04, inclination)
        * smoothstep(-0.015, 0.025, p.y);

    float approaching = 0.5 + 0.5 * cos(azimuth - uAzimuth);
    float beaming = mix(0.74, 0.82 + uDoppler * 0.42, approaching);
    float lensBeaming = mix(0.78, 1.08, approaching);
    float totalHeat = directHeat * beaming + upperHeat * lensBeaming
        + lowerHeat * mix(0.76, 1.04, approaching);
    vec3 color = thermalColor(totalHeat) * totalHeat * 1.75;
    color += vec3(1.0, 0.27, 0.015) * photon * (0.42 + uDoppler * 0.2);

    float bloom = lineGlow(abs(p.y), mix(0.12, 0.035, edge))
        * (1.0 - smoothstep(1.15, 1.92, abs(p.x))) * 0.055;
    color += vec3(0.7, 0.018, 0.0) * bloom;

    float visibleEmission = clamp(
        directWindow
            + upperMask * higherOrderVisibility
            + lowerMask * higherOrderVisibility
            + photon
            + bloom * 5.0,
        0.0,
        1.0
    );
    float shadowShape = length(vec2(
        (p.x - spinShift) / (criticalX * 0.98),
        (p.y - 0.01) / 0.61
    ));
    float shadowAlpha = 1.0 - smoothstep(0.96, 1.015, shadowShape);
    float alpha = max(shadowAlpha, visibleEmission);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
}
`;

export const ACCRETION_DISK_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vDiskPosition;
uniform float uTime;
uniform float uSpin;
uniform float uInclination;
uniform float uDoppler;
uniform float uBeamingAngle;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
        f.y
    );
}

void main() {
    float radius = length(vDiskPosition);
    float radial = clamp((radius - 2.02) / (4.35 - 2.02), 0.0, 1.0);
    float angle = atan(vDiskPosition.y, vDiskPosition.x);
    float rotation = uTime * (0.09 + uSpin * 0.24);

    float coarseNoise = noise(vec2(angle * 5.0 - rotation, radial * 28.0));
    float fineNoise = noise(vec2(angle * 13.0 + rotation * 0.4, radial * 74.0));
    float shear = angle * (18.0 + uSpin * 7.0)
        - log(max(radius, 2.02)) * 42.0
        - rotation * 9.0;
    float narrowStreaks = 0.5 + 0.5 * sin(shear + fineNoise * 1.2);
    float broadStreaks = 0.5 + 0.5 * sin(shear * 0.43 - coarseNoise);
    float textureFlow = 0.62
        + coarseNoise * 0.18
        + fineNoise * 0.1
        + narrowStreaks * 0.07
        + broadStreaks * 0.05;

    float innerFade = smoothstep(2.02, 2.2, radius);
    float outerFade = 1.0 - smoothstep(3.72, 4.35, radius);
    float radialHeat = pow(1.0 - radial, 1.18);
    float emission = radialHeat * textureFlow;
    emission *= innerFade * outerFade;

    float approaching = 0.5 + 0.5 * cos(angle - uBeamingAngle);
    float beaming = mix(0.68, 0.76 + uDoppler * 0.82, approaching);
    beaming *= mix(1.0, 0.94, uInclination);

    vec3 ember = vec3(0.12, 0.009, 0.002);
    vec3 orange = vec3(0.88, 0.12, 0.008);
    vec3 gold = vec3(1.0, 0.48, 0.08);
    vec3 whiteHot = vec3(1.0, 0.88, 0.61);
    vec3 color = mix(ember, orange, smoothstep(0.03, 0.46, emission));
    color = mix(color, gold, smoothstep(0.32, 0.76, emission));
    color = mix(color, whiteHot, smoothstep(0.64, 0.98, emission * beaming));

    float alpha = clamp((0.14 + emission * 0.86) * beaming, 0.0, 0.88);
    alpha *= innerFade * outerFade;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(color * (0.48 + emission * 0.48), alpha);
}
`;

export const LENSING_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LENSING_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uBackdrop;
uniform float uStrength;

void main() {
    vec2 centered = vUv - 0.5;
    centered.x *= 2.02;
    float radius = max(length(centered), 0.035);
    float einsteinRadius = 0.255 + uStrength * 0.026;
    float mappedRadius = abs(radius - (einsteinRadius * einsteinRadius) / radius);
    vec2 direction = centered / radius;
    vec2 mapped = direction * mappedRadius;
    mapped.x /= 2.02;
    vec2 sampleUv = clamp(mapped + 0.5, vec2(0.002), vec2(0.998));

    vec3 color = texture2D(uBackdrop, sampleUv).rgb;
    float ring = exp(-pow((radius - einsteinRadius) / 0.018, 2.0));
    color += vec3(1.0, 0.72, 0.38) * ring * 0.16;
    float vignette = 1.0 - smoothstep(0.24, 0.92, length(vUv - 0.5));
    gl_FragColor = vec4(color * (0.7 + vignette * 0.3), 1.0);
}
`;

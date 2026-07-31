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

import * as THREE from 'three';

export function gravitationalWaveRadiusRg(observationTimeS, emissionTimeS, gravitationalTimeS) {
    return Math.max(0, (observationTimeS - emissionTimeS) / gravitationalTimeS);
}

const GRID_VERTEX_SHADER = `
    uniform float uWavePhase;
    uniform float uWavelengthRg;
    uniform float uPlusWeight;
    uniform float uCrossWeight;
    uniform float uStrength;
    varying vec2 vGrid;
    varying float vDisplacement;

    void main() {
        vGrid = position.xy;
        float radius = length(position.xy);
        float angle = atan(position.y, position.x);
        float envelope = 1.0 - smoothstep(7.0, 16.0, radius);
        float radialRg = pow(max(radius * 2.4, 0.0), 1.65);
        float retardedPhase = uWavePhase - 6.2831853 * radialRg / max(uWavelengthRg, 3.0);
        float plus = uPlusWeight * cos(retardedPhase);
        float cross = uCrossWeight * sin(retardedPhase);
        mat2 tidalTensor = mat2(plus, cross, cross, -plus);
        vec3 transformed = position;
        transformed.xy += uStrength * 0.055 * envelope * tidalTensor * position.xy;
        float quadrupole = cos(2.0 * angle) * plus + sin(2.0 * angle) * cross;
        float deformation = uStrength * 0.028 * envelope * quadrupole;
        transformed.z += deformation;
        vDisplacement = deformation;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
`;

const GRID_FRAGMENT_SHADER = `
    varying vec2 vGrid;
    varying float vDisplacement;

    void main() {
        vec2 cell = fract(vGrid);
        vec2 distanceToLine = min(cell, 1.0 - cell);
        float line = 1.0 - smoothstep(0.025, 0.075, min(distanceToLine.x, distanceToLine.y));
        float radius = length(vGrid);
        float fade = 1.0 - smoothstep(7.0, 16.0, radius);
        vec3 cool = vec3(0.12, 0.34, 0.58);
        vec3 warm = vec3(1.0, 0.51, 0.19);
        vec3 color = mix(cool, warm, smoothstep(-0.35, 0.35, vDisplacement));
        float alpha = fade * (0.055 + line * 0.34);
        gl_FragColor = vec4(color, alpha);
    }
`;

const WAVE_VERTEX_SHADER = `
    varying float vAngle;
    void main() {
        vAngle = atan(position.y, position.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const WAVE_FRAGMENT_SHADER = `
    uniform float uPhase;
    uniform float uOpacity;
    varying float vAngle;
    void main() {
        float signedLobe = cos(2.0 * (vAngle - uPhase));
        float lobe = smoothstep(0.08, 0.95, abs(signedLobe));
        vec3 compression = vec3(1.0, 0.48, 0.16);
        vec3 stretch = vec3(0.25, 0.65, 1.0);
        vec3 color = mix(stretch, compression, step(0.0, signedLobe));
        gl_FragColor = vec4(color, uOpacity * (0.12 + 0.88 * lobe));
    }
`;

function horizonMesh(color) {
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1 })
    );
    const glowColor = new THREE.Color(color);
    const rim = new THREE.Mesh(
        new THREE.SphereGeometry(1.12, 48, 24),
        new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: glowColor },
                uOpacity: { value: 0.7 }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-viewPosition.xyz);
                    gl_Position = projectionMatrix * viewPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uOpacity;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    float fresnel = pow(1.0 - abs(dot(vNormal, vView)), 2.2);
                    gl_FragColor = vec4(uColor, uOpacity * (0.08 + 0.92 * fresnel));
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        })
    );
    group.add(rim, sphere);
    group.userData = { sphere, rim };
    return group;
}

function setHorizonOpacity(horizon, opacity) {
    const bounded = Math.min(1, Math.max(0, opacity));
    horizon.userData.sphere.material.opacity = bounded;
    horizon.userData.rim.material.uniforms.uOpacity.value = bounded * 0.72;
}

function trailLine(color, capacity = 420) {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    const colors = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    colors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    geometry.setAttribute('color', colors);
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72 })
    );
    line.userData = { capacity, color: new THREE.Color(color) };
    return line;
}

function updateTrail(line, samples, positionKey) {
    const { capacity, color } = line.userData;
    const positions = line.geometry.getAttribute('position');
    const colors = line.geometry.getAttribute('color');
    const start = Math.max(0, samples.length - capacity);
    let drawIndex = 0;
    for (let sampleIndex = start; sampleIndex < samples.length; sampleIndex += 1) {
        const sample = samples[sampleIndex];
        if (!(sample.separationM > 0) || !sample[positionKey]) continue;
        const separationVisual = 1.7 + Math.sqrt(Math.max(0, sample.separationRg - 1)) * 0.48;
        const physicalPosition = sample[positionKey];
        const visualRatio = separationVisual / sample.separationM;
        positions.setXYZ(drawIndex, physicalPosition[0] * visualRatio, 0.18, physicalPosition[1] * visualRatio);
        const fade = (sampleIndex - start + 1) / Math.max(1, samples.length - start);
        colors.setXYZ(drawIndex, color.r * fade ** 2, color.g * fade ** 2, color.b * fade ** 2);
        drawIndex += 1;
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    line.geometry.setDrawRange(0, drawIndex);
}

export class BinaryMergerRenderer {
    constructor() {
        this.group = new THREE.Group();
        this.grid = new THREE.Mesh(
            new THREE.PlaneGeometry(30, 30, 72, 72),
            new THREE.ShaderMaterial({
                uniforms: {
                    uWavePhase: { value: 0 },
                    uWavelengthRg: { value: 200 },
                    uPlusWeight: { value: 1 },
                    uCrossWeight: { value: 1 },
                    uStrength: { value: 0 }
                },
                vertexShader: GRID_VERTEX_SHADER,
                fragmentShader: GRID_FRAGMENT_SHADER,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            })
        );
        this.grid.rotation.x = -Math.PI / 2;
        this.grid.position.y = -0.06;
        this.group.add(this.grid);

        this.primary = horizonMesh(0xffbd69);
        this.secondary = horizonMesh(0x70b7ff);
        this.remnant = horizonMesh(0xffdf9e);
        this.remnant.visible = false;
        this.group.add(this.primary, this.secondary, this.remnant);

        this.trail1 = trailLine(0xff9d4f);
        this.trail2 = trailLine(0x70b7ff);
        this.group.add(this.trail1, this.trail2);

        this.mergerFlash = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 18),
            new THREE.MeshBasicMaterial({
                color: 0xffcf83,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending
            })
        );
        this.mergerFlash.visible = false;
        this.group.add(this.mergerFlash);

        this.wavefronts = Array.from({ length: 28 }, (_, index) => {
            const wave = new THREE.Mesh(
                new THREE.TorusGeometry(1, 0.012 + index * 0.0005, 8, 96),
                new THREE.ShaderMaterial({
                    uniforms: {
                        uPhase: { value: 0 },
                        uOpacity: { value: 0 }
                    },
                    vertexShader: WAVE_VERTEX_SHADER,
                    fragmentShader: WAVE_FRAGMENT_SHADER,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                })
            );
            wave.rotation.x = Math.PI / 2;
            this.group.add(wave);
            return wave;
        });
    }

    update(snapshot, options, emissions, trailSamples = []) {
        const total = snapshot.masses.totalSolar;
        const separationVisual = snapshot.separationRg > 0
            ? 1.7 + Math.sqrt(Math.max(0, snapshot.separationRg - 1)) * 0.48
            : 0;
        const r1 = separationVisual * snapshot.masses.m2Solar / total;
        const r2 = separationVisual * snapshot.masses.m1Solar / total;
        const cos = Math.cos(snapshot.phase);
        const sin = Math.sin(snapshot.phase);
        this.primary.position.set(cos * r1, 0.18, sin * r1);
        this.secondary.position.set(-cos * r2, 0.18, -sin * r2);
        const primaryScale = 0.34 + 0.48 * Math.sqrt(snapshot.masses.m1Solar / total);
        const secondaryScale = 0.34 + 0.48 * Math.sqrt(snapshot.masses.m2Solar / total);
        const tidalProgress = Math.min(1, Math.max(0, (snapshot.evolutionProgress - 0.81) / 0.13));
        const tidalStretch = 0.065 * tidalProgress ** 2;
        this.primary.rotation.y = -snapshot.phase;
        this.secondary.rotation.y = -snapshot.phase;
        this.primary.scale.set(
            primaryScale * (1 + tidalStretch),
            primaryScale * (1 - tidalStretch * 0.35),
            primaryScale * (1 - tidalStretch * 0.5)
        );
        this.secondary.scale.set(
            secondaryScale * (1 + tidalStretch),
            secondaryScale * (1 - tidalStretch * 0.35),
            secondaryScale * (1 - tidalStretch * 0.5)
        );
        updateTrail(this.trail1, trailSamples, 'body1PositionM');
        updateTrail(this.trail2, trailSamples, 'body2PositionM');

        const merged = snapshot.regime === 'RINGDOWN' || snapshot.regime === 'FINAL KERR BLACK HOLE';
        const mergerStart = 0.82 + 0.12 * 0.58;
        const formation = Math.min(1, Math.max(0, (snapshot.evolutionProgress - mergerStart) / (0.94 - mergerStart)));
        const smoothFormation = formation * formation * (3 - 2 * formation);
        this.primary.visible = !merged && formation < 1;
        this.secondary.visible = !merged && formation < 1;
        this.primary.position.multiplyScalar(1 - 0.3 * smoothFormation);
        this.secondary.position.multiplyScalar(1 - 0.3 * smoothFormation);
        setHorizonOpacity(this.primary, 1 - smoothFormation);
        setHorizonOpacity(this.secondary, 1 - smoothFormation);
        this.trail1.visible = options.showTrails && !merged;
        this.trail2.visible = options.showTrails && !merged;
        this.remnant.visible = merged || formation > 0.01;
        setHorizonOpacity(this.remnant, merged ? 1 : smoothFormation);
        const remnantBase = 0.75 + snapshot.remnant.finalSpin * 0.12;
        const emergence = merged ? 1 : 0.18 + 0.82 * smoothFormation;
        const ringDecay = snapshot.regime === 'RINGDOWN'
            ? Math.exp(-snapshot.ringdownElapsedS / snapshot.ringdown.dampingTimeS)
            : 0;
        const formationDistortion = merged ? 0 : (1 - smoothFormation) * Math.sin(snapshot.phase * 2) * 0.16;
        const ringDistortion = ringDecay * Math.cos(snapshot.mergerPhase) * 0.18;
        const distortion = formationDistortion + ringDistortion;
        this.remnant.scale.set(
            remnantBase * emergence * (1 + distortion),
            remnantBase * emergence * (1 - distortion * 0.55),
            remnantBase * emergence * (1 - distortion)
        );

        this.grid.visible = options.showGrid;
        const wavePhase = snapshot.regime === 'RINGDOWN' || snapshot.regime === 'FINAL KERR BLACK HOLE'
            ? snapshot.mergerPhase
            : 2 * snapshot.phase;
        const inclination = snapshot.inclinationDegrees * Math.PI / 180;
        const plusWeight = (1 + Math.cos(inclination) ** 2) / 2;
        const crossWeight = Math.cos(inclination);
        const visualDeformation = options.amplification * (0.1 + Math.min(0.65, snapshot.strainAmplitude * 5e19));
        this.grid.material.uniforms.uWavePhase.value = wavePhase;
        this.grid.material.uniforms.uWavelengthRg.value = snapshot.gwWavelengthRg;
        this.grid.material.uniforms.uPlusWeight.value = options.polarization === 'cross' ? 0 : plusWeight;
        this.grid.material.uniforms.uCrossWeight.value = options.polarization === 'plus' ? 0 : crossWeight;
        this.grid.material.uniforms.uStrength.value = visualDeformation;

        const planckLuminosity = 3.62831e52;
        const powerResponse = Math.min(1, Math.sqrt(Math.max(0, snapshot.powerW) / planckLuminosity) * 38);
        const flashOffset = (snapshot.evolutionProgress - 0.94) / 0.018;
        const flashEnvelope = Math.exp(-(flashOffset ** 2));
        const flashStrength = powerResponse * flashEnvelope;
        this.mergerFlash.visible = flashStrength > 0.005;
        this.mergerFlash.material.opacity = 0.42 * flashStrength;
        this.mergerFlash.scale.setScalar(remnantBase * (2.2 + 7 * flashStrength));

        this.wavefronts.forEach((wave, index) => {
            const emission = emissions[emissions.length - 1 - index];
            if (!options.showWaves || !emission) {
                wave.material.uniforms.uOpacity.value = 0;
                return;
            }
            // Physical propagation is c*age. Only the render mapping from r/rg
            // to scene units is square-root compressed to span the wave zone.
            const radiusRg = gravitationalWaveRadiusRg(
                snapshot.timeS,
                emission.timeS,
                snapshot.masses.gravitationalTimeS
            );
            const radius = 1.2 + Math.sqrt(radiusRg) * 0.5;
            const selectedStrain = options.polarization === 'plus'
                ? Math.abs(emission.hPlus)
                : options.polarization === 'cross'
                    ? Math.abs(emission.hCross)
                    : Math.hypot(emission.hPlus, emission.hCross);
            const response = Math.min(1, selectedStrain / Math.max(1e-30, emission.strainAmplitude));
            const selectedAmplitude = emission.displayAmplitude * Math.sqrt(response);
            const quadrupole = 0.12 * options.amplification * selectedAmplitude;
            wave.scale.set(
                radius * (1 + quadrupole * Math.cos(emission.gwPhase)),
                radius * (1 - quadrupole * Math.cos(emission.gwPhase)),
                radius
            );
            wave.material.uniforms.uPhase.value = options.polarization === 'plus'
                ? 0
                : options.polarization === 'cross'
                    ? Math.PI / 4
                    : emission.polarizationAxis;
            const powerIntensity = 0.55 + 0.45 * Math.min(1, Math.sqrt(emission.powerW / 5.5e48));
            wave.material.uniforms.uOpacity.value = selectedAmplitude * powerIntensity * Math.max(0, 0.78 - radius / 50);
        });
    }
}

export function drawBinaryWaveform(canvas, samples, polarization = 'both') {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#01040a';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(130,160,195,.22)';
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    if (samples.length < 2) return;
    const series = polarization === 'plus'
        ? [['hPlus', '#ffbd69']]
        : polarization === 'cross'
            ? [['hCross', '#70b7ff']]
            : [['hPlus', '#ffbd69'], ['hCross', '#70b7ff']];
    const peak = Math.max(1e-30, ...samples.flatMap(sample => series.map(([key]) => Math.abs(sample[key]))));
    for (const [key, color] of series) {
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.beginPath();
        samples.forEach((sample, index) => {
            const x = index / (samples.length - 1) * width;
            const y = height / 2 - sample[key] / peak * height * 0.42;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();
    }
}

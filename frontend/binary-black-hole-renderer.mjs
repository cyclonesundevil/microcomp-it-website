import * as THREE from 'three';

const GRID_VERTEX_SHADER = `
    uniform float uPhase;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vGrid;
    varying float vDisplacement;

    void main() {
        vGrid = position.xy;
        float radius = length(position.xy);
        float angle = atan(position.y, position.x);
        float envelope = 1.0 - smoothstep(2.0, 15.0, radius);
        float quadrupole = cos(2.0 * (angle - uPhase));
        float traveling = sin(radius * 2.25 - uTime * 0.34);
        float deformation = uStrength * envelope * quadrupole * (0.34 + 0.66 * traveling);
        vec3 transformed = position;
        transformed.z += deformation - uStrength * 0.22 * exp(-radius * 0.22);
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

function trailLine(color) {
    const points = [];
    const colors = [];
    const dim = new THREE.Color(color).multiplyScalar(0.08);
    const bright = new THREE.Color(color);
    for (let index = 0; index <= 112; index += 1) {
        const fraction = index / 112;
        const angle = -Math.PI * 2 * (1 - fraction);
        points.push(new THREE.Vector3(Math.cos(angle), 0.015, Math.sin(angle)));
        const shade = dim.clone().lerp(bright, fraction ** 2.4);
        colors.push(shade.r, shade.g, shade.b);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72 })
    );
}

export class BinaryMergerRenderer {
    constructor() {
        this.group = new THREE.Group();
        this.grid = new THREE.Mesh(
            new THREE.PlaneGeometry(30, 30, 72, 72),
            new THREE.ShaderMaterial({
                uniforms: {
                    uPhase: { value: 0 },
                    uTime: { value: 0 },
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

        this.wavefronts = Array.from({ length: 14 }, (_, index) => {
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

    update(snapshot, options, emissions) {
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
        this.primary.scale.setScalar(primaryScale);
        this.secondary.scale.setScalar(secondaryScale);
        this.trail1.scale.setScalar(r1);
        this.trail2.scale.setScalar(r2);
        this.trail1.rotation.y = -snapshot.phase;
        this.trail2.rotation.y = -snapshot.phase + Math.PI;

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
        const visualDeformation = options.amplification * Math.min(0.65, snapshot.strainAmplitude * 5e19);
        this.grid.material.uniforms.uPhase.value = snapshot.phase;
        this.grid.material.uniforms.uTime.value = snapshot.mergerPhase || snapshot.phase;
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
            const radiusRg = Math.max(0, (snapshot.timeS - emission.timeS) / snapshot.masses.gravitationalTimeS);
            const radius = 1.2 + Math.sqrt(radiusRg) * 0.5;
            const quadrupole = 0.08 * options.amplification * emission.relativeAmplitude;
            wave.scale.set(radius * (1 + quadrupole * Math.cos(2 * emission.phase)), radius * (1 - quadrupole * Math.cos(2 * emission.phase)), radius);
            wave.material.uniforms.uPhase.value = emission.phase;
            wave.material.uniforms.uOpacity.value = Math.max(0, 0.34 - radius / 64);
        });
    }
}

export function drawBinaryWaveform(canvas, samples) {
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
    const peak = Math.max(1e-30, ...samples.flatMap(sample => [Math.abs(sample.hPlus), Math.abs(sample.hCross)]));
    for (const [key, color] of [['hPlus', '#ffbd69'], ['hCross', '#70b7ff']]) {
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

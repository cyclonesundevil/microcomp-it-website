import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { computeBlackHoleModel } from './black-hole-model.mjs';
import {
    ACCRETION_DISK_FRAGMENT_SHADER,
    ACCRETION_DISK_VERTEX_SHADER,
    BLACK_HOLE_MODES,
    BLACK_HOLE_PALETTE,
    createSeededRandom,
    getBlackHoleRenderProfile,
    LENSING_FRAGMENT_SHADER,
    LENSING_VERTEX_SHADER
} from './black-hole-visuals.mjs?v=2.0';

const container = document.getElementById('black-hole-scene');

if (container) {
    const inputs = {
        mass: document.getElementById('bh-mass'),
        spin: document.getElementById('bh-spin'),
        angle: document.getElementById('bh-angle')
    };
    const labels = {
        mass: document.getElementById('bh-mass-value'),
        spin: document.getElementById('bh-spin-value'),
        angle: document.getElementById('bh-angle-value')
    };
    const modeButtons = document.querySelectorAll('[data-bh-mode]');
    const resetViewButton = document.getElementById('bh-reset-view');
    const animationToggle = document.getElementById('bh-animation-toggle');
    const animationToggleIcon = animationToggle?.querySelector('i');
    const animationToggleLabel = animationToggle?.querySelector('span');
    const renderStatus = document.getElementById('bh-render-status');
    const webglFallback = document.getElementById('bh-webgl-fallback');
    const angleLabel = inputs.angle.closest('label');
    const angleHelp = document.getElementById('bh-angle-help');
    const modeSummary = {
        badge: document.getElementById('bh-mode-badge'),
        title: document.getElementById('bh-mode-title'),
        description: document.getElementById('bh-mode-description'),
        interaction: document.getElementById('bh-mode-interaction')
    };
    const legend = document.getElementById('bh-mode-legend');
    const readouts = {
        horizon: document.getElementById('bh-horizon-readout'),
        isco: document.getElementById('bh-isco-readout'),
        time: document.getElementById('bh-time-readout'),
        redshift: document.getElementById('bh-redshift-readout'),
        doppler: document.getElementById('bh-doppler-readout')
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BLACK_HOLE_PALETTE.space);
    scene.fog = new THREE.FogExp2(BLACK_HOLE_PALETTE.space, 0.026);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 90);
    camera.position.set(0, 10.7, 11.9);

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            antialias: true,
            // Keep paused and reduced-motion views visible between repaints.
            preserveDrawingBuffer: true
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.92;
        container.appendChild(renderer.domElement);
    } catch (error) {
        console.error('Black Hole Playground could not initialize WebGL.', error);
        container.classList.add('context-unavailable');
        if (webglFallback) webglFallback.hidden = false;
        if (animationToggle) animationToggle.disabled = true;
        if (renderStatus) {
            renderStatus.textContent = 'Interactive 3D view unavailable.';
        }
    }

    if (renderer) {
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 22;
    controls.minPolarAngle = THREE.MathUtils.degToRad(0.5);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    controls.target.set(0, 0, 0);

    const root = new THREE.Group();
    scene.add(root);
    const accretionGroup = new THREE.Group();
    const lensingGroup = new THREE.Group();
    const waveGroup = new THREE.Group();
    const wellGroup = new THREE.Group();
    accretionGroup.position.x = 0.65;
    lensingGroup.position.x = 1.05;
    waveGroup.position.x = 1.05;
    wellGroup.position.x = 0.75;
    root.add(accretionGroup, lensingGroup, waveGroup, wellGroup);
    const requestedMode = new URLSearchParams(window.location.search).get(
        'mode'
    );
    let activeMode = BLACK_HOLE_MODES[requestedMode]
        ? requestedMode
        : 'disk';
    const reducedMotionQuery = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
    );
    let userPaused = reducedMotionQuery.matches;
    let contextAvailable = true;
    let animationFrameId = null;
    let lastFrameTime = 0;
    let lastAnimatedTime = 0;
    let renderProfile = getBlackHoleRenderProfile({
        width: container.getBoundingClientRect().width,
        devicePixelRatio: window.devicePixelRatio || 1,
        reducedMotion: userPaused
    });

    const starPositions = [];
    const starColors = [];
    const starRandom = createSeededRandom(0xb1ac701e);
    for (let i = 0; i < 920; i += 1) {
        starPositions.push(
            (starRandom() - 0.5) * 42,
            (starRandom() - 0.5) * 26,
            (starRandom() - 0.5) * 42
        );
        const temperature = starRandom();
        if (temperature > 0.82) {
            starColors.push(0.62, 0.75, 1);
        } else if (temperature < 0.18) {
            starColors.push(1, 0.72, 0.48);
        } else {
            starColors.push(0.88, 0.9, 0.94);
        }
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const stars = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
            size: 0.028,
            transparent: true,
            opacity: 0.72,
            vertexColors: true,
            depthWrite: false
        })
    );
    root.add(stars);

    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(1.34, 96, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    accretionGroup.add(horizon);

    const shadowGlow = new THREE.Mesh(
        new THREE.SphereGeometry(1.68, 96, 48),
        new THREE.MeshBasicMaterial({
            color: 0x2b160d,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        })
    );
    accretionGroup.add(shadowGlow);

    const photonRingGlow = new THREE.Mesh(
        new THREE.TorusGeometry(1.84, 0.09, 24, 192),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photonGlow,
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    accretionGroup.add(photonRingGlow);

    const photonRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.84, 0.018, 18, 192),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photon,
            transparent: true,
            opacity: 0.76,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    accretionGroup.add(photonRing);

    const diskGroup = new THREE.Group();
    diskGroup.rotation.x = Math.PI / 2;
    accretionGroup.add(diskGroup);

    const diskUniforms = {
        uTime: { value: 0 },
        uSpin: { value: 0.42 },
        uInclination: { value: 48 / 85 },
        uDoppler: { value: 0.5 },
        uBeamingAngle: { value: 0 }
    };
    const accretionDisk = new THREE.Mesh(
        new THREE.RingGeometry(2.02, 4.35, 256, 24),
        new THREE.ShaderMaterial({
            uniforms: diskUniforms,
            vertexShader: ACCRETION_DISK_VERTEX_SHADER,
            fragmentShader: ACCRETION_DISK_FRAGMENT_SHADER,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    diskGroup.add(accretionDisk);

    const innerGlow = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.055, 20, 192),
        new THREE.MeshBasicMaterial({
            color: 0xffc266,
            transparent: true,
            opacity: 0.52,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    diskGroup.add(innerGlow);

    const lensArcGroup = new THREE.Group();
    accretionGroup.add(lensArcGroup);
    function makeLensedDiskArc(verticalControl, color, opacity, radius) {
        const curve = new THREE.CubicBezierCurve3(
            new THREE.Vector3(-2.18, 0.02, 0.08),
            new THREE.Vector3(-1.55, verticalControl, 0.12),
            new THREE.Vector3(1.55, verticalControl, 0.12),
            new THREE.Vector3(2.18, 0.02, 0.08)
        );
        return new THREE.Mesh(
            new THREE.TubeGeometry(curve, 144, radius, 10, false),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
    }

    const lensArcs = [
        makeLensedDiskArc(1.82, 0xffc778, 0.24, 0.045),
        makeLensedDiskArc(-1.08, 0xa94920, 0.12, 0.027)
    ];
    lensArcGroup.add(...lensArcs);

    function makeLensingTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const random = createSeededRandom(0x1e1157a2);
        const sky = ctx.createRadialGradient(490, 240, 10, 490, 240, 650);
        sky.addColorStop(0, '#18202b');
        sky.addColorStop(0.32, '#0b1018');
        sky.addColorStop(1, '#010204');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-0.12);
        const galacticBand = ctx.createLinearGradient(0, -125, 0, 125);
        galacticBand.addColorStop(0, 'rgba(35,42,53,0)');
        galacticBand.addColorStop(0.38, 'rgba(129,111,86,0.12)');
        galacticBand.addColorStop(0.5, 'rgba(218,193,157,0.2)');
        galacticBand.addColorStop(0.56, 'rgba(43,31,27,0.3)');
        galacticBand.addColorStop(0.68, 'rgba(124,119,112,0.1)');
        galacticBand.addColorStop(1, 'rgba(35,42,53,0)');
        ctx.fillStyle = galacticBand;
        ctx.fillRect(-700, -180, 1400, 360);
        ctx.restore();

        for (let i = 0; i < 1800; i += 1) {
            const x = random() * canvas.width;
            const y = random() * canvas.height;
            const bandDistance = Math.abs(
                y - (canvas.height * 0.5 - (x - canvas.width * 0.5) * 0.12)
            );
            const inBand = random() < Math.max(0.08, 0.62 - bandDistance / 190);
            if (!inBand && random() > 0.16) continue;
            const radius = random() > 0.985 ? 1.15 : 0.25 + random() * 0.55;
            const warmth = random();
            const color = warmth < 0.16
                ? `rgba(255,190,130,${0.28 + random() * 0.45})`
                : warmth > 0.82
                    ? `rgba(165,195,255,${0.3 + random() * 0.45})`
                    : `rgba(235,239,245,${0.24 + random() * 0.5})`;
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        const vignette = ctx.createRadialGradient(512, 256, 80, 512, 256, 520);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.76)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    const lensingUniforms = {
        uBackdrop: { value: makeLensingTexture() },
        uStrength: { value: 1 }
    };
    const lensBackdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(10.5, 5.2, 80, 28),
        new THREE.ShaderMaterial({
            uniforms: lensingUniforms,
            vertexShader: LENSING_VERTEX_SHADER,
            fragmentShader: LENSING_FRAGMENT_SHADER,
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );
    lensBackdrop.position.z = -1.4;
    lensingGroup.add(lensBackdrop);

    const lensShadow = new THREE.Mesh(
        new THREE.SphereGeometry(1.28, 96, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    lensingGroup.add(lensShadow);

    const lensHalo = new THREE.Mesh(
        new THREE.TorusGeometry(1.55, 0.035, 18, 180),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photon,
            transparent: true,
            opacity: 0.78,
            blending: THREE.AdditiveBlending
        })
    );
    lensingGroup.add(lensHalo);

    const lensBands = [];
    for (let i = 0; i < 3; i += 1) {
        const band = new THREE.Mesh(
            new THREE.TorusGeometry(1.78 + i * 0.18, 0.01, 8, 180, Math.PI * (1.08 - i * 0.045)),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0xd5b386 : 0xa8b3bf,
                transparent: true,
                opacity: 0.12,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        band.rotation.z = Math.PI * 0.02 * i;
        lensBands.push(band);
        lensingGroup.add(band);
    }

    const rayMaterials = [
        new THREE.MeshBasicMaterial({ color: BLACK_HOLE_PALETTE.rayWarm, transparent: true, opacity: 0.48, depthWrite: false }),
        new THREE.MeshBasicMaterial({ color: BLACK_HOLE_PALETTE.rayNeutral, transparent: true, opacity: 0.55, depthWrite: false }),
        new THREE.MeshBasicMaterial({ color: BLACK_HOLE_PALETTE.rayCool, transparent: true, opacity: 0.42, depthWrite: false })
    ];
    const lensRayGroup = new THREE.Group();
    const waveRayGroup = new THREE.Group();
    lensingGroup.add(lensRayGroup);
    waveGroup.add(waveRayGroup);

    const waveShadow = new THREE.Mesh(
        new THREE.SphereGeometry(1.28, 96, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    waveGroup.add(waveShadow);

    const wavePhotonRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.55, 0.035, 18, 180),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photon,
            transparent: true,
            opacity: 0.74,
            blending: THREE.AdditiveBlending
        })
    );
    waveGroup.add(wavePhotonRing);

    const wavefronts = [];
    for (let i = 0; i < 7; i += 1) {
        const wave = new THREE.Mesh(
            new THREE.TorusGeometry(0.72 + i * 0.08, 0.012, 8, 112),
            new THREE.MeshBasicMaterial({
                color: i % 2
                    ? BLACK_HOLE_PALETTE.rayCool
                    : BLACK_HOLE_PALETTE.rayNeutral,
                transparent: true,
                opacity: 0.2,
                depthWrite: false
            })
        );
        wave.rotation.y = Math.PI / 2;
        wavefronts.push(wave);
        waveGroup.add(wave);
    }

    const causticArcs = [];
    for (let i = 0; i < 4; i += 1) {
        const arc = new THREE.Mesh(
            new THREE.TorusGeometry(2.05 + i * 0.34, 0.011, 8, 128, Math.PI * (0.62 + i * 0.05)),
            new THREE.MeshBasicMaterial({
                color: i % 2
                    ? BLACK_HOLE_PALETTE.rayWarm
                    : BLACK_HOLE_PALETTE.rayNeutral,
                transparent: true,
                opacity: 0.13,
                depthWrite: false
            })
        );
        arc.rotation.z = -0.5 + i * 0.28;
        causticArcs.push(arc);
        waveGroup.add(arc);
    }

    function disposeGroupChildren(group) {
        group.children.forEach((child) => {
            child.geometry?.dispose();
        });
        group.clear();
    }

    function makeLightRay(offset, bend, material, wave = false) {
        const side = Math.sign(offset) || 1;
        const near = Math.max(0.72, Math.abs(offset) * 0.38);
        const points = [
            new THREE.Vector3(-5.9, offset, -0.12),
            new THREE.Vector3(-2.45, offset * 0.72, 0.18 * side),
            new THREE.Vector3(-0.72, side * near, bend * side),
            new THREE.Vector3(0.78, side * near * 0.9, -bend * 0.42 * side),
            new THREE.Vector3(5.9, offset * 0.18, 0.05)
        ];
        if (wave) {
            points.splice(3, 0, new THREE.Vector3(0, side * near * 0.74, 0.28 * Math.sin(offset * 2)));
        }
        const curve = new THREE.CatmullRomCurve3(points);
        return new THREE.Mesh(
            new THREE.TubeGeometry(curve, 96, wave ? 0.018 : 0.022, 8, false),
            material
        );
    }

    function rebuildLightRays(model) {
        disposeGroupChildren(lensRayGroup);
        disposeGroupChildren(waveRayGroup);
        const bend = 0.34 + model.lensing * 0.24 + model.massScale * 0.18;
        const offsets = [-1.9, -0.95, 0.95, 1.9];
        offsets.forEach((offset, index) => {
            const material = rayMaterials[index % rayMaterials.length];
            const ray = makeLightRay(offset, bend, material, false);
            lensRayGroup.add(ray);

            const waveRay = makeLightRay(offset, bend * 1.08, material.clone(), true);
            waveRay.material.opacity = 0.46;
            waveRayGroup.add(waveRay);
        });
    }

    function makeWellGeometry(depth = 2.8, spinTwist = 0.2) {
        const segments = 70;
        const rings = 34;
        const positions = [];
        const indices = [];

        for (let r = 0; r <= rings; r += 1) {
            const radial = 0.9 + (r / rings) * 5.4;
            const sink = -depth / (radial * radial * 0.38 + 0.44);
            for (let s = 0; s <= segments; s += 1) {
                const theta = (s / segments) * Math.PI * 2 + spinTwist / Math.max(0.9, radial);
                positions.push(Math.cos(theta) * radial, sink, Math.sin(theta) * radial);
            }
        }

        for (let r = 0; r < rings; r += 1) {
            for (let s = 0; s < segments; s += 1) {
                const a = r * (segments + 1) + s;
                const b = a + 1;
                const c = a + segments + 1;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    const wellCore = new THREE.Group();
    wellCore.rotation.x = -0.18;
    wellGroup.add(wellCore);

    let wellMesh = new THREE.Mesh(
        makeWellGeometry(),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.grid,
            transparent: true,
            opacity: 0.2,
            wireframe: true
        })
    );
    wellCore.add(wellMesh);

    const wellHorizon = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.035, 12, 120),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photon,
            transparent: true,
            opacity: 0.76
        })
    );
    wellHorizon.rotation.x = Math.PI / 2;
    wellCore.add(wellHorizon);

    const wellColumn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.48, 4.8, 36, 1, true),
        new THREE.MeshBasicMaterial({
            color: 0x66778b,
            transparent: true,
            opacity: 0.12,
            wireframe: true
        })
    );
    wellColumn.position.y = -2.25;
    wellCore.add(wellColumn);

    const wellOrbit = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.018, 8, 160),
        new THREE.MeshBasicMaterial({
            color: BLACK_HOLE_PALETTE.photonGlow,
            transparent: true,
            opacity: 0.72
        })
    );
    wellOrbit.rotation.x = Math.PI / 2.25;
    wellCore.add(wellOrbit);

    function state() {
        const mass = Number(inputs.mass.value);
        const spin = Number(inputs.spin.value) / 100;
        const angle = Number(inputs.angle.value);
        const massScale = (mass - 8) / 82;
        const angleScale = angle / 85;
        const physics = computeBlackHoleModel({
            massSolar: mass,
            spin,
            observerAngleDegrees: angle
        });
        return {
            mass,
            spin,
            angle,
            massScale,
            angleScale,
            physics,
            lensing: 6 / physics.iscoRadiusRg,
            redshift: Math.min(2, physics.gravitationalRedshift)
        };
    }

    function update() {
        const model = state();

        labels.mass.textContent = `${model.mass} solar masses`;
        labels.spin.textContent = `${model.spin.toFixed(2)} a*`;
        labels.angle.textContent = `${model.angle} degrees`;

        readouts.horizon.textContent =
            `${model.physics.horizonDiameterKm.toFixed(1)} km`;
        readouts.isco.textContent =
            `${model.physics.iscoRadiusRg.toFixed(2)} r_g`;
        readouts.time.textContent =
            `${model.physics.orbitClockRatio.toFixed(2)}\u00d7`;
        readouts.redshift.textContent =
            `z = ${model.physics.gravitationalRedshift.toFixed(2)}`;
        readouts.doppler.textContent =
            `${model.physics.dopplerBrightnessContrast.toFixed(1)}\u00d7`;

        const spinHorizonScale = model.physics.horizonRadiusRg / 2;
        const horizonScale =
            (0.86 + model.massScale * 0.5) * spinHorizonScale;
        horizon.scale.setScalar(horizonScale);
        shadowGlow.scale.setScalar(1 + model.massScale * 0.55);
        photonRing.scale.setScalar(0.88 + model.lensing * 0.17);
        photonRingGlow.scale.copy(photonRing.scale);
        innerGlow.scale.setScalar(0.92 + model.spin * 0.22);
        const diskScale = 0.92
            + (model.physics.iscoRadiusRg / 6) * 0.13
            + model.massScale * 0.08;
        diskGroup.scale.setScalar(diskScale);
        diskUniforms.uSpin.value = model.spin;
        diskUniforms.uInclination.value = model.angleScale;
        diskUniforms.uDoppler.value = Math.min(
            1,
            Math.log2(model.physics.dopplerBrightnessContrast + 1) / 5
        );
        const observerVector = camera.position.clone().sub(controls.target);
        const observerDiskAzimuth = Math.atan2(
            observerVector.z,
            observerVector.x
        );
        diskUniforms.uBeamingAngle.value =
            observerDiskAzimuth - Math.PI / 2;
        lensArcGroup.scale.setScalar(0.9 + model.lensing * 0.18);
        lensArcs.forEach((arc, index) => {
            arc.material.opacity = index === 0
                ? 0.14 + model.lensing * 0.045
                : 0.055 + model.lensing * 0.018;
        });

        lensShadow.scale.setScalar(0.92 + model.massScale * 0.44);
        lensHalo.scale.setScalar(0.9 + model.lensing * 0.22);
        lensingUniforms.uStrength.value = model.lensing;
        lensBackdrop.scale.set(1 + model.lensing * 0.06, 1 + model.angleScale * 0.06, 1);
        lensBackdrop.rotation.z = THREE.MathUtils.degToRad((model.angle - 48) * 0.08);
        lensBands.forEach((band, index) => {
            band.scale.set(1 + model.lensing * 0.08, 0.72 + model.angleScale * 0.26, 1);
            band.material.opacity = 0.055 + model.lensing * 0.026 - index * 0.003;
        });
        rebuildLightRays(model);

        waveShadow.scale.setScalar(0.92 + model.massScale * 0.44);
        wavePhotonRing.scale.setScalar(0.9 + model.lensing * 0.22);
        waveRayGroup.scale.set(1 + model.lensing * 0.04, 1 + model.angleScale * 0.08, 1);
        causticArcs.forEach((arc, index) => {
            arc.scale.set(1 + model.lensing * 0.06, 0.8 + model.angleScale * 0.22, 1);
            arc.material.opacity = 0.05 + model.lensing * 0.03 - index * 0.006;
        });

        wellMesh.geometry.dispose();
        wellMesh.geometry = makeWellGeometry(2.25 + model.massScale * 2.1, model.spin * 2.2);
        wellCore.scale.setScalar(0.9 + model.lensing * 0.06);
        wellCore.rotation.z = model.spin * 0.08;
        wellMesh.scale.setScalar(1);
        wellHorizon.scale.setScalar(0.92 + model.massScale * 0.45);
        wellColumn.scale.set(1 + model.spin * 0.35, 1 + model.massScale * 0.28, 1 + model.spin * 0.35);
        wellOrbit.scale.setScalar(0.88 + model.lensing * 0.18);
    }

    let synchronizingObserver = false;

    function cameraDistanceForMode(narrow) {
        if (activeMode === 'well') return narrow ? 14.5 : 12.5;
        return narrow ? 18.5 : 16;
    }

    function positionCameraForObserverAngle(
        angleDegrees,
        distance = camera.position.distanceTo(controls.target),
        azimuth = controls.getAzimuthalAngle()
    ) {
        const inclination = THREE.MathUtils.degToRad(
            THREE.MathUtils.clamp(angleDegrees, 0.5, 85)
        );
        const radial = Math.sin(inclination) * distance;
        synchronizingObserver = true;
        camera.position.set(
            controls.target.x + Math.sin(azimuth) * radial,
            controls.target.y + Math.cos(inclination) * distance,
            controls.target.z + Math.cos(azimuth) * radial
        );
        controls.update();
        synchronizingObserver = false;
    }

    function syncObserverAngleFromCamera() {
        if (synchronizingObserver) return;
        const angle = Math.round(THREE.MathUtils.radToDeg(
            controls.getPolarAngle()
        ));
        if (Number(inputs.angle.value) === angle) {
            update();
            if (userPaused) renderStaticScene();
            return;
        }
        inputs.angle.value = String(angle);
        update();
        if (userPaused) renderStaticScene();
    }

    function resetObserverView() {
        controls.target.set(0, activeMode === 'well' ? -0.65 : 0, 0);
        inputs.angle.value = '48';
        const narrow = container.getBoundingClientRect().width < 620;
        positionCameraForObserverAngle(
            48,
            cameraDistanceForMode(narrow),
            0
        );
        update();
        renderStaticScene();
    }

    function renderModeLegend(items) {
        const entries = items.map((item) => {
            const entry = document.createElement('span');
            const marker = document.createElement('i');
            marker.className = `black-hole-legend-marker ${item.marker}`;
            marker.setAttribute('aria-hidden', 'true');
            entry.append(marker, document.createTextNode(item.label));
            return entry;
        });
        legend.replaceChildren(...entries);
    }

    function setMode(mode) {
        const config = BLACK_HOLE_MODES[mode];
        if (!config) return;
        activeMode = mode;
        accretionGroup.visible = mode === 'disk';
        lensingGroup.visible = mode === 'lensing';
        waveGroup.visible = mode === 'wave';
        wellGroup.visible = mode === 'well';
        controls.enabled = config.rotatable;
        inputs.angle.disabled = !config.rotatable;
        angleLabel?.classList.toggle('control-disabled', !config.rotatable);
        if (angleHelp) {
            angleHelp.textContent = config.rotatable
                ? '0° is face-on. Use this slider or drag vertically; horizontal dragging changes azimuth without changing inclination.'
                : 'Observer angle is held in this fixed-frame mode.';
        }
        modeButtons.forEach((button) => {
            const selected = button.dataset.bhMode === mode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        modeSummary.badge.textContent = config.badge;
        modeSummary.title.textContent = config.title;
        modeSummary.description.textContent = config.description;
        modeSummary.interaction.textContent = config.interaction;
        container.setAttribute('aria-label', config.sceneLabel);
        renderModeLegend(config.legend);
        if (mode === 'well') {
            controls.target.set(0, -0.65, 0);
        } else {
            controls.target.set(0, 0, 0);
        }
        resize();
    }

    function storeModeInUrl(mode) {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', mode);
        window.history.replaceState({}, '', url);
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(420, Math.floor(rect.height));
        const narrow = width < 620;
        renderProfile = getBlackHoleRenderProfile({
            width,
            devicePixelRatio: window.devicePixelRatio || 1,
            reducedMotion: userPaused
        });
        renderer.setPixelRatio(renderProfile.pixelRatio);
        positionCameraForObserverAngle(
            Number(inputs.angle.value),
            cameraDistanceForMode(narrow)
        );
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        root.scale.setScalar(activeMode === 'well' ? (narrow ? 0.72 : 0.86) : (narrow ? 0.76 : 0.9));
        renderer.setSize(width, height, false);
        renderStaticScene();
    }

    function renderScene(now, advanceMotion) {
        const model = state();
        if (advanceMotion) lastAnimatedTime = now;
        const time = lastAnimatedTime * 0.001;

        diskUniforms.uTime.value = time;
        if (advanceMotion) {
            innerGlow.rotation.z -= 0.0008 + model.spin * 0.0012;
        }
        photonRing.rotation.z = Math.sin(time * 0.32) * 0.018;
        photonRingGlow.rotation.z = photonRing.rotation.z;
        if (advanceMotion) {
            lensHalo.rotation.z -= 0.0006 + model.spin * 0.0008;
            lensBands.forEach((band, index) => {
                band.rotation.z += 0.00018 + index * 0.000025;
            });
        }
        wavePhotonRing.rotation.z = Math.sin(time * 0.9) * 0.08;
        wavefronts.forEach((wave, index) => {
            const travel = ((time * (0.38 + model.spin * 0.12) + index * 0.24) % 1);
            const x = -4.2 + travel * 8.4;
            const lensPass = Math.max(0, 1 - Math.abs(x) / (1.25 + model.lensing * 0.25));
            const radius = 0.7 + travel * 1.25 + lensPass * model.lensing * 0.18;
            wave.position.set(x, Math.sin(time * 1.8 + index) * 0.05 * model.angleScale, 0);
            wave.scale.set(radius * (1 + lensPass * 0.2), radius * (1 - lensPass * 0.12), radius);
            wave.material.opacity = activeMode === 'wave'
                ? Math.max(0, 0.08 + lensPass * 0.22 + (1 - Math.abs(travel - 0.5) * 1.8) * 0.16)
                : 0;
        });
        if (advanceMotion) {
            causticArcs.forEach((arc, index) => {
                arc.rotation.z += 0.0018 + index * 0.0004 + model.spin * 0.001;
            });
            wellOrbit.rotation.z += 0.004 + model.spin * 0.008;
            wellColumn.rotation.y += 0.003;
            stars.rotation.y += 0.00008;
        }
        shadowGlow.material.opacity =
            0.12 + Math.sin(time * 0.45) * 0.012 + model.massScale * 0.035;

        controls.update();
        photonRing.quaternion.copy(camera.quaternion);
        photonRingGlow.quaternion.copy(camera.quaternion);
        lensArcGroup.quaternion.copy(camera.quaternion);
        lensingGroup.quaternion.copy(camera.quaternion);
        renderer.render(scene, camera);
        window.__blackHoleReady = true;
        container.dataset.renderStatus = 'ready';
        container.classList.remove('context-unavailable');
        if (webglFallback) webglFallback.hidden = true;
        const runtimeIndicator = document.getElementById(
            'bh-runtime-indicator'
        );
        if (runtimeIndicator) {
            runtimeIndicator.textContent = '3D view ready';
            runtimeIndicator.classList.remove('failed');
            runtimeIndicator.classList.add('ready');
        }
    }

    function renderStaticScene() {
        if (!contextAvailable || !renderer) return;
        renderScene(lastAnimatedTime || performance.now(), false);
    }

    function shouldAnimate() {
        return contextAvailable
            && !userPaused
            && !document.hidden;
    }

    function scheduleAnimation() {
        if (!shouldAnimate() || animationFrameId !== null) return;
        animationFrameId = requestAnimationFrame(animate);
    }

    function stopAnimation() {
        if (animationFrameId === null) return;
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    function animate(now) {
        animationFrameId = null;
        if (!shouldAnimate()) return;
        const minimumFrameDuration =
            1000 / renderProfile.maximumFramesPerSecond;
        if (now - lastFrameTime >= minimumFrameDuration) {
            lastFrameTime = now;
            renderScene(now, true);
        }
        scheduleAnimation();
    }

    function updateAnimationControl(message) {
        const paused = userPaused || !contextAvailable;
        if (!animationToggle) return;
        animationToggle.disabled = !contextAvailable;
        animationToggle.setAttribute('aria-pressed', String(paused));
        animationToggleLabel.textContent = paused
            ? 'Resume motion'
            : 'Pause motion';
        animationToggleIcon.className = paused
            ? 'fa-solid fa-play'
            : 'fa-solid fa-pause';
        if (message && renderStatus) renderStatus.textContent = message;
    }

    function setAnimationPaused(paused, message) {
        userPaused = paused;
        renderProfile = getBlackHoleRenderProfile({
            width: container.getBoundingClientRect().width,
            devicePixelRatio: window.devicePixelRatio || 1,
            reducedMotion: paused
        });
        renderer.setPixelRatio(renderProfile.pixelRatio);
        updateAnimationControl(message);
        if (paused) {
            stopAnimation();
            renderStaticScene();
        } else {
            scheduleAnimation();
        }
    }

    [inputs.mass, inputs.spin].forEach((input) => {
        input.addEventListener('input', () => {
            update();
            renderStaticScene();
        });
    });

    inputs.angle.addEventListener('input', () => {
        positionCameraForObserverAngle(Number(inputs.angle.value));
        update();
        renderStaticScene();
    });

    controls.addEventListener('change', syncObserverAngleFromCamera);

    resetViewButton?.addEventListener('click', resetObserverView);

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setMode(button.dataset.bhMode);
            storeModeInUrl(button.dataset.bhMode);
        });
    });

    animationToggle?.addEventListener('click', () => {
        const paused = !userPaused;
        setAnimationPaused(
            paused,
            paused ? 'Scene motion paused.' : 'Scene motion resumed.'
        );
    });

    container.addEventListener('keydown', (event) => {
        const config = BLACK_HOLE_MODES[activeMode];
        if (event.key === 'Home') {
            event.preventDefault();
            resetObserverView();
            if (renderStatus) {
                renderStatus.textContent = 'Observer view reset.';
            }
            return;
        }
        if (!config.rotatable) return;

        const angleStep = event.shiftKey ? 5 : 2;
        const azimuthStep = event.shiftKey ? 0.16 : 0.08;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? -1 : 1;
            inputs.angle.value = String(THREE.MathUtils.clamp(
                Number(inputs.angle.value) + direction * angleStep,
                Number(inputs.angle.min),
                Number(inputs.angle.max)
            ));
            positionCameraForObserverAngle(Number(inputs.angle.value));
            update();
            renderStaticScene();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const direction = event.key === 'ArrowLeft' ? -1 : 1;
            positionCameraForObserverAngle(
                Number(inputs.angle.value),
                camera.position.distanceTo(controls.target),
                controls.getAzimuthalAngle() + direction * azimuthStep
            );
            update();
            renderStaticScene();
        }
    });

    renderer.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        contextAvailable = false;
        stopAnimation();
        container.classList.add('context-unavailable');
        if (webglFallback) webglFallback.hidden = false;
        updateAnimationControl('The 3D graphics context was lost.');
    });

    renderer.domElement.addEventListener('webglcontextrestored', () => {
        contextAvailable = true;
        container.classList.remove('context-unavailable');
        if (webglFallback) webglFallback.hidden = true;
        updateAnimationControl('The 3D graphics context was restored.');
        resize();
        scheduleAnimation();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAnimation();
        } else {
            renderStaticScene();
            scheduleAnimation();
        }
    });

    const handleReducedMotionChange = (event) => {
        setAnimationPaused(
            event.matches,
            event.matches
                ? 'Motion paused to follow your reduced-motion preference.'
                : 'Motion resumed after your reduced-motion preference changed.'
        );
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener(
            'change',
            handleReducedMotionChange
        );
    } else {
        reducedMotionQuery.addListener(handleReducedMotionChange);
    }

    if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
    } else {
        window.addEventListener('resize', resize);
    }

    setMode(activeMode);
    resize();
    update();
    updateAnimationControl(
        userPaused
            ? 'Motion paused to follow your reduced-motion preference.'
            : 'Scene motion is active.'
    );
    renderStaticScene();
    scheduleAnimation();
    requestAnimationFrame(() => {
        resize();
        renderStaticScene();
        scheduleAnimation();
    });
    }
}

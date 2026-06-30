import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('universe-scene');

if (container) {
    const zoomInput = document.getElementById('universe-zoom');
    const stopSelect = document.getElementById('universe-stop-select');
    const zoomValue = document.getElementById('universe-zoom-value');
    const title = document.getElementById('universe-focus-title');
    const description = document.getElementById('universe-focus-description');
    const scaleReadout = document.getElementById('universe-scale-readout');
    const distanceReadout = document.getElementById('universe-distance-readout');
    const solarScaleSelect = document.getElementById('solar-scale-select');
    const solarScaleNote = document.getElementById('solar-scale-note');
    const contextNote = document.getElementById('universe-context-note');
    const modeButtons = document.querySelectorAll('[data-universe-mode]');
    const earthSurfaceLaunch = document.getElementById('earth-surface-launch');
    const earthSurfaceOverlay = document.getElementById('earth-surface-overlay');
    const earthSurfaceClose = document.getElementById('earth-surface-close');
    const earthSurfaceMap = document.getElementById('earth-surface-map');
    const earthSurfaceStatus = document.getElementById('earth-surface-status');

    const KM_PER_AU = 149_597_870.7;
    const KM_PER_LY = 9_460_730_472_580.8;

    const stops = [
        {
            id: 'earth',
            label: 'Earth Orbit',
            scale: 6_371,
            distance: 6_371,
            camera: new THREE.Vector3(0, 3.8, 12),
            target: new THREE.Vector3(0, 0, 0),
            description: 'Earth is shown as a measured anchor, with orbiting satellites and atmosphere scaled for visibility.'
        },
        {
            id: 'moon',
            label: 'Earth-Moon System',
            scale: 384_400,
            distance: 384_400,
            camera: new THREE.Vector3(0, 7, 22),
            target: new THREE.Vector3(0, 0, 0),
            description: 'The Moon sits at its average orbital distance of about 384,400 km from Earth.'
        },
        {
            id: 'solar',
            label: 'Solar System',
            scale: 30 * KM_PER_AU,
            distance: KM_PER_AU,
            camera: new THREE.Vector3(0, 16, 44),
            target: new THREE.Vector3(0, 0, 0),
            description: 'Planet positions use average orbital radii, compressed logarithmically so inner and outer planets can share one view.'
        },
        {
            id: 'nearby-stars',
            label: 'Nearby Stars',
            scale: 4.2465 * KM_PER_LY,
            distance: 4.2465 * KM_PER_LY,
            camera: new THREE.Vector3(0, 30, 76),
            target: new THREE.Vector3(0, 0, 0),
            description: 'Proxima Centauri is represented at roughly 4.2465 light-years, with nearby stars plotted as measured-scale anchors.'
        },
        {
            id: 'milky-way',
            label: 'Milky Way',
            scale: 100_000 * KM_PER_LY,
            distance: 26_700 * KM_PER_LY,
            camera: new THREE.Vector3(0, 150, 46),
            target: new THREE.Vector3(0, 0, 0),
            description: 'The galaxy view uses the Milky Way diameter and Sun-to-center distance as anchors, with procedural arms for visual density.'
        },
        {
            id: 'local-group',
            label: 'Local Group',
            scale: 2_500_000 * KM_PER_LY,
            distance: 2_537_000 * KM_PER_LY,
            camera: new THREE.Vector3(0, 72, 150),
            target: new THREE.Vector3(0, 0, 0),
            description: 'The Andromeda Galaxy is placed at about 2.537 million light-years, with Local Group companions around it.'
        },
        {
            id: 'observable',
            label: 'Observable Universe',
            scale: 93_000_000_000 * KM_PER_LY,
            distance: 46_500_000_000 * KM_PER_LY,
            camera: new THREE.Vector3(0, 100, 220),
            target: new THREE.Vector3(0, 0, 0),
            description: 'The observable universe horizon is represented as a 93-billion-light-year diameter shell with procedural large-scale structure.'
        }
    ];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x01030a);
    scene.fog = new THREE.FogExp2(0x01030a, 0.008);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);
    camera.position.copy(stops[2].camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };
    controls.minDistance = 5;
    controls.maxDistance = 260;
    controls.target.copy(stops[2].target);

    scene.add(new THREE.AmbientLight(0x8fa8ff, 0.42));
    const sunLight = new THREE.PointLight(0xffffff, 3.5, 130);
    scene.add(sunLight);
    const rimLight = new THREE.DirectionalLight(0x55e8ff, 1.6);
    rimLight.position.set(-4, 6, 8);
    scene.add(rimLight);

    const root = new THREE.Group();
    scene.add(root);

    const groups = {
        earth: new THREE.Group(),
        solar: new THREE.Group(),
        stars: new THREE.Group(),
        galaxy: new THREE.Group(),
        local: new THREE.Group(),
        cosmic: new THREE.Group(),
        labels: new THREE.Group()
    };
    Object.values(groups).forEach((group) => root.add(group));

    const labelSprites = [];
    let activeMode = 'atlas';
    let currentZoom = Number(zoomInput.value);
    let cameraTransitionFrames = 80;
    let lastScaleTransitionAt = 0;
    let scaleTransitionLock = null;
    const savedViews = new Map();
    let earthSurfaceWidget = null;
    let earthSurfaceTileset = null;
    let earthSurfaceLoading = false;

    function logPosition(km, minKm = 6_371, maxUnits = 72) {
        return Math.log10(Math.max(km, minKm) / minKm + 1) * maxUnits / Math.log10((93_000_000_000 * KM_PER_LY) / minKm + 1);
    }

    function formatDistance(km) {
        if (km >= KM_PER_LY) {
            const ly = km / KM_PER_LY;
            if (ly >= 1_000_000_000) return `${(ly / 1_000_000_000).toFixed(1)}B ly`;
            if (ly >= 1_000_000) return `${(ly / 1_000_000).toFixed(2)}M ly`;
            if (ly >= 1_000) return `${(ly / 1_000).toFixed(1)}K ly`;
            return `${ly.toFixed(2)} ly`;
        }
        if (km >= KM_PER_AU) return `${(km / KM_PER_AU).toFixed(2)} AU`;
        if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(1)}M km`;
        return `${Math.round(km).toLocaleString()} km`;
    }

    function makeLabel(text, position, color = '#dffbff', minZoom = 0, maxZoom = 6, scaleMultiplier = 1) {
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(2, 6, 16, 0.72)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.42)';
        ctx.lineWidth = 3;
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(14, 18, 740, 76, 14);
        } else {
            ctx.rect(14, 18, 740, 76);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        const fontSize = text.length > 28 ? 26 : 34;
        ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
        ctx.fillText(text, 34, 69);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        const labelWidth = Math.max(7, Math.min(14, text.length * 0.26));
        sprite.scale.set(labelWidth * scaleMultiplier, 1.7 * scaleMultiplier, 1);
        sprite.userData.baseScale = sprite.scale.clone();
        sprite.userData.minZoom = minZoom;
        sprite.userData.maxZoom = maxZoom;
        groups.labels.add(sprite);
        labelSprites.push(sprite);
        return sprite;
    }

    function makeSphere(radius, color, position, materialOptions = {}) {
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.62,
            metalness: 0.04,
            ...materialOptions
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
        mesh.position.copy(position);
        return mesh;
    }

    function makeEarthTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
        ocean.addColorStop(0, '#0d5da8');
        ocean.addColorStop(0.5, '#126fc4');
        ocean.addColorStop(1, '#083d7a');
        ctx.fillStyle = ocean;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'source-over';
        for (let continent = 0; continent < 9; continent += 1) {
            const cx = Math.random() * canvas.width;
            const cy = canvas.height * (0.24 + Math.random() * 0.52);
            const points = 16 + Math.floor(Math.random() * 12);
            ctx.beginPath();
            for (let i = 0; i <= points; i += 1) {
                const theta = (i / points) * Math.PI * 2;
                const radius = 26 + Math.random() * 78;
                const x = cx + Math.cos(theta) * radius * (1.5 + Math.random());
                const y = cy + Math.sin(theta) * radius * (0.55 + Math.random() * 0.55);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.fillStyle = Math.random() > 0.35 ? 'rgba(52, 138, 78, 0.88)' : 'rgba(180, 152, 92, 0.86)';
            ctx.fill();
        }

        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 46; i += 1) {
            const y = Math.random() * canvas.height;
            ctx.beginPath();
            ctx.ellipse(Math.random() * canvas.width, y, 45 + Math.random() * 120, 4 + Math.random() * 12, Math.random() * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.055 + Math.random() * 0.085})`;
            ctx.fill();
        }

        return new THREE.CanvasTexture(canvas);
    }

    function makeMoonTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const base = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        base.addColorStop(0, '#b9bdc0');
        base.addColorStop(0.55, '#8f9497');
        base.addColorStop(1, '#6e7376');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < 120; i += 1) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const r = 2 + Math.random() * 16;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(50,52,54,${0.08 + Math.random() * 0.16})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.72, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(235,238,240,${0.08 + Math.random() * 0.12})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        for (let i = 0; i < 22; i += 1) {
            ctx.beginPath();
            ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 22 + Math.random() * 48, 8 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(70,72,75,${0.08 + Math.random() * 0.1})`;
            ctx.fill();
        }

        return new THREE.CanvasTexture(canvas);
    }

    function makeOrbit(radius, color = 0x2de5ff, opacity = 0.24) {
        return new THREE.Mesh(
            new THREE.RingGeometry(radius - 0.015, radius + 0.015, 160),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide })
        );
    }

    const earth = makeSphere(1.25, 0xffffff, new THREE.Vector3(0, 0, 0), {
        map: makeEarthTexture(),
        emissive: 0x052448,
        emissiveIntensity: 0.08,
        roughness: 0.48,
        metalness: 0.02
    });
    groups.earth.add(earth);
    const atmosphere = makeSphere(1.35, 0x7be7ff, new THREE.Vector3(0, 0, 0), {
        transparent: true,
        opacity: 0.18,
        depthWrite: false
    });
    groups.earth.add(atmosphere);

    const moonDistance = 7.2;
    const moon = makeSphere(0.34, 0xffffff, new THREE.Vector3(moonDistance, 0, 0), {
        map: makeMoonTexture(),
        emissive: 0x4a4a4a,
        emissiveIntensity: 0.16,
        roughness: 0.92,
        metalness: 0
    });
    groups.earth.add(moon);
    const moonOrbit = makeOrbit(moonDistance, 0x91a8c8, 0.28);
    groups.earth.add(moonOrbit);
    const earthLabel = makeLabel('Earth', new THREE.Vector3(0, 2.75, 0), '#dffbff', 0, 1.72, 0.62);
    const moonLabel = makeLabel('Moon 384,400 km', new THREE.Vector3(moonDistance + 1.2, 1.35, 0), '#dffbff', 0.4, 1.82, 0.62);

    const planets = [
        ['Mercury', 0.387, 0.24, 0xb8a38d, 2_439.7],
        ['Venus', 0.723, 0.46, 0xd8b56a, 6_051.8],
        ['Earth', 1, 0.5, 0x2f8cff, 6_371],
        ['Mars', 1.524, 0.34, 0xd65f3f, 3_389.5],
        ['Jupiter', 5.203, 0.95, 0xe0b47b, 69_911],
        ['Saturn', 9.537, 0.82, 0xe5d29a, 58_232],
        ['Uranus', 19.191, 0.62, 0x8fe7ef, 25_362],
        ['Neptune', 30.07, 0.6, 0x416fff, 24_622]
    ];
    const solarPlanetEntries = [];
    const solarDistanceSceneMax = 42;
    const sunRadiusKm = 695_700;

    const sun = makeSphere(1.6, 0xffd36f, new THREE.Vector3(0, 0, 0), {
        emissive: 0xffa31a,
        emissiveIntensity: 1.2
    });
    sun.userData.baseRadius = 1.6;
    groups.solar.add(sun);
    sunLight.position.copy(sun.position);
    planets.forEach(([name, au, radius, color, radiusKm], index) => {
        const distance = logPosition(au * KM_PER_AU, 6_371, 42);
        const angle = index * 0.72 + 0.4;
        const planet = makeSphere(radius, color, new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
        planet.userData.orbitAngle = angle;
        planet.userData.orbitRadius = distance;
        planet.userData.baseRadius = radius;
        groups.solar.add(planet);
        const orbit = makeOrbit(distance, 0x2de5ff, index < 4 ? 0.24 : 0.15);
        orbit.rotation.x = Math.PI / 2;
        orbit.userData.isOrbit = true;
        groups.solar.add(orbit);
        let label = null;
        if (name === 'Earth' || name === 'Jupiter' || name === 'Neptune') {
            label = makeLabel(name, planet.position.clone().add(new THREE.Vector3(0, radius + 1.25, 0)), '#dffbff', 1.2, 2.65);
        }
        const locator = new THREE.Mesh(
            new THREE.RingGeometry(0.18, 0.24, 32),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
        );
        locator.rotation.x = Math.PI / 2;
        locator.position.copy(planet.position);
        groups.solar.add(locator);
        solarPlanetEntries.push({ name, au, radiusKm, visualRadius: radius, color, planet, orbit, label, locator, angle });
    });

    const starData = [
        ['Proxima Centauri', 4.2465, 0.34, 0xff8f6c],
        ['Sirius', 8.6, 0.48, 0xe9f6ff],
        ['Barnard Star', 5.96, 0.28, 0xffb58a],
        ['Vega', 25.04, 0.5, 0xcfe7ff],
        ['TRAPPIST-1', 40.66, 0.28, 0xff7c5f]
    ];
    starData.forEach(([name, ly, size, color], index) => {
        const distance = 30 + Math.log10(ly + 1) * 20;
        const angle = index * 1.18 + 0.35;
        const y = (index - 2) * 4.8;
        const star = makeSphere(size, color, new THREE.Vector3(Math.cos(angle) * distance, y, Math.sin(angle) * distance), {
            emissive: color,
            emissiveIntensity: 1.4
        });
        groups.stars.add(star);
        makeLabel(name, star.position.clone().add(new THREE.Vector3(0, 2.2, 0)), '#dffbff', 2.7, 3.72);
    });

    function setOrbitRadius(orbit, radius) {
        orbit.geometry.dispose();
        orbit.geometry = new THREE.RingGeometry(Math.max(0.001, radius - 0.015), radius + 0.015, 160);
    }

    function applySolarScaleMode() {
        const mode = solarScaleSelect ? solarScaleSelect.value : 'readable';
        const notes = {
            readable: 'Distances are logarithmically compressed and planet sizes are enlarged.',
            distance: 'Orbital distances are linear by AU; planet sizes remain enlarged so they stay visible.',
            size: 'Planet sizes are proportional to the Sun; distances remain compressed so the system fits.',
            true: 'Distances and planet sizes are proportional; locator rings show planets that are otherwise nearly invisible.'
        };
        if (solarScaleNote) {
            solarScaleNote.textContent = notes[mode] || notes.readable;
        }

        const distanceForAu = (au) => {
            if (mode === 'distance' || mode === 'true') {
                return (au / 30.07) * solarDistanceSceneMax;
            }
            return logPosition(au * KM_PER_AU, 6_371, solarDistanceSceneMax);
        };
        const sunRadius = mode === 'size' ? 2.5 : mode === 'true' ? 0.64 : mode === 'distance' ? 0.75 : 1.6;
        sun.scale.setScalar(sunRadius / sun.userData.baseRadius);

        solarPlanetEntries.forEach((entry) => {
            const distance = distanceForAu(entry.au);
            const accurateRadius = sunRadius * (entry.radiusKm / sunRadiusKm);
            let displayedRadius = entry.visualRadius;
            let locatorOpacity = 0;

            if (mode === 'distance') {
                displayedRadius = Math.max(entry.visualRadius * 0.22, accurateRadius * 14);
                locatorOpacity = 0.2;
            } else if (mode === 'size') {
                displayedRadius = accurateRadius;
                locatorOpacity = entry.name === 'Jupiter' || entry.name === 'Saturn' ? 0.08 : 0.2;
            } else if (mode === 'true') {
                displayedRadius = accurateRadius;
                locatorOpacity = 0.28;
            }

            entry.planet.userData.orbitRadius = distance;
            entry.planet.position.set(Math.cos(entry.angle) * distance, 0, Math.sin(entry.angle) * distance);
            entry.planet.scale.setScalar(Math.max(displayedRadius / entry.visualRadius, 0.001));
            setOrbitRadius(entry.orbit, distance);
            entry.locator.position.copy(entry.planet.position);
            entry.locator.scale.setScalar(mode === 'true' ? 1.8 : mode === 'distance' ? 1.45 : 1.25);
            entry.locator.material.opacity = locatorOpacity;
            if (entry.label) {
                const labelLift = mode === 'readable' ? entry.visualRadius + 1.25 : mode === 'distance' ? displayedRadius + 1.45 : 1.2;
                const labelOffsetX = entry.name === 'Jupiter' ? -1.6 : 1.25;
                entry.label.position.copy(entry.planet.position).add(new THREE.Vector3(labelOffsetX, labelLift, 0));
            }
        });
    }

    function makePointCloud(count, radius, colorA, colorB, size, spreadY = 1) {
        const positions = [];
        const colors = [];
        const colorOne = new THREE.Color(colorA);
        const colorTwo = new THREE.Color(colorB);
        for (let i = 0; i < count; i += 1) {
            const r = Math.sqrt(Math.random()) * radius;
            const a = Math.random() * Math.PI * 2;
            const y = (Math.random() - 0.5) * spreadY;
            positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
            const color = colorOne.clone().lerp(colorTwo, Math.random());
            colors.push(color.r, color.g, color.b);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        return new THREE.Points(geometry, new THREE.PointsMaterial({
            size,
            transparent: true,
            opacity: 0.78,
            vertexColors: true,
            depthWrite: false
        }));
    }

    function makeGalaxyGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const center = 512;
        const armOffsets = [-0.2, 0.95, 2.65, 3.82];
        const armLengths = [0.92, 0.78, 1, 0.68];
        const diskGradient = ctx.createRadialGradient(center, center, 30, center, center, 490);
        diskGradient.addColorStop(0, 'rgba(255,232,178,0.22)');
        diskGradient.addColorStop(0.2, 'rgba(150,200,255,0.15)');
        diskGradient.addColorStop(0.65, 'rgba(95,160,230,0.09)');
        diskGradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = diskGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = 'lighter';
        const bulgeGradient = ctx.createRadialGradient(center, center, 8, center, center, 135);
        bulgeGradient.addColorStop(0, 'rgba(255,230,165,0.28)');
        bulgeGradient.addColorStop(0.42, 'rgba(255,204,128,0.12)');
        bulgeGradient.addColorStop(1, 'rgba(255,204,128,0)');
        ctx.fillStyle = bulgeGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let arm = 0; arm < 4; arm += 1) {
            const segmentCount = 4 + (arm % 2);
            for (let segment = 0; segment < segmentCount; segment += 1) {
                const start = 0.06 + segment * 0.2 + Math.random() * 0.03;
                const end = Math.min(armLengths[arm], start + 0.13 + Math.random() * 0.13);
                ctx.beginPath();
                for (let i = 0; i <= 80; i += 1) {
                    const t = start + (end - start) * (i / 80);
                    const r = 38 + t * 420;
                    const ripple = Math.sin(t * 18 + arm * 1.7) * 0.12 + Math.sin(t * 43 + arm) * 0.045;
                    const theta = -0.48 + armOffsets[arm] + t * (4.75 + arm * 0.14) + ripple;
                    const x = center + Math.cos(theta) * r;
                    const y = center + Math.sin(theta) * r;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = 'rgba(150,215,255,0.12)';
                ctx.lineWidth = 10 + Math.random() * 6;
                ctx.stroke();
                ctx.strokeStyle = 'rgba(255,210,230,0.055)';
                ctx.lineWidth = 3 + Math.random() * 3;
                ctx.stroke();
            }
        }

        ctx.globalCompositeOperation = 'destination-out';
        for (let lane = 0; lane < 7; lane += 1) {
            const arm = lane % 4;
            ctx.beginPath();
            for (let i = 0; i <= 110; i += 1) {
                const t = 0.08 + (i / 110) * (0.72 + Math.random() * 0.12);
                const r = 42 + t * 390 + lane * 2.2;
                const theta = -0.42 + armOffsets[arm] + t * (4.6 + arm * 0.13) + Math.sin(t * 23 + lane) * 0.11;
                const x = center + Math.cos(theta) * r;
                const y = center + Math.sin(theta) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.18)';
            ctx.lineWidth = 5 + Math.random() * 7;
            ctx.stroke();
        }

        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 95; i += 1) {
            const arm = Math.floor(Math.random() * 4);
            const t = 0.12 + Math.random() * armLengths[arm] * 0.86;
            const r = 42 + t * 400;
            const theta = -0.48 + armOffsets[arm] + t * (4.75 + arm * 0.14) + Math.sin(t * 18 + arm * 1.7) * 0.12;
            const x = center + Math.cos(theta) * r + (Math.random() - 0.5) * 26;
            const y = center + Math.sin(theta) * r + (Math.random() - 0.5) * 26;
            const nebula = ctx.createRadialGradient(x, y, 0, x, y, 10 + Math.random() * 14);
            nebula.addColorStop(0, Math.random() > 0.45 ? 'rgba(255,105,160,0.32)' : 'rgba(120,220,255,0.26)');
            nebula.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = nebula;
            ctx.fillRect(x - 26, y - 26, 52, 52);
        }

        return new THREE.CanvasTexture(canvas);
    }

    function makeGalaxyRing(radius, opacity = 0.18) {
        const points = [];
        for (let i = 0; i <= 192; i += 1) {
            const theta = (i / 192) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(theta) * radius, 0.05, Math.sin(theta) * radius));
        }
        return new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0x7ea6d8, transparent: true, opacity: opacity * 0.36, depthWrite: false })
        );
    }

    function makeGalaxySpoke(angle, radius) {
        const points = [
            new THREE.Vector3(Math.cos(angle) * 2.2, 0.06, Math.sin(angle) * 2.2),
            new THREE.Vector3(Math.cos(angle) * radius, 0.06, Math.sin(angle) * radius)
        ];
        return new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0x5f86b8, transparent: true, opacity: 0.018, depthWrite: false })
        );
    }

    function makeSpiralArmGuide(armIndex, radius) {
        const points = [];
        for (let i = 0; i <= 140; i += 1) {
            const t = i / 140;
            const r = 5 + t * radius;
            const theta = -0.48 + armIndex * (Math.PI * 0.5) + t * 5.6;
            points.push(new THREE.Vector3(Math.cos(theta) * r, 0.12, Math.sin(theta) * r));
        }
        return new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0x74d7ff, transparent: true, opacity: 0.026, depthWrite: false })
        );
    }

    function makeSpiralGalaxy(count, radius, colorA, colorB, size) {
        const positions = [];
        const colors = [];
        const colorOne = new THREE.Color(colorA);
        const colorTwo = new THREE.Color(colorB);
        const arms = 4;
        const barLength = radius * 0.34;
        const armOffsets = [-0.2, 0.95, 2.65, 3.82];
        const armReach = [0.92, 0.78, 1, 0.68];

        function gaussianRandom() {
            const u = 1 - Math.random();
            const v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
        }

        for (let i = 0; i < count; i += 1) {
            const inBar = Math.random() < 0.11;
            let x;
            let y;
            let z;

            if (inBar) {
                const along = THREE.MathUtils.clamp(gaussianRandom() * barLength * 0.22, -barLength * 0.46, barLength * 0.46);
                const endTaper = 1 - Math.min(0.92, Math.abs(along) / (barLength * 0.58));
                const across = gaussianRandom() * radius * 0.034 * (0.25 + endTaper);
                const barAngle = -0.48;
                x = Math.cos(barAngle) * along - Math.sin(barAngle) * across;
                z = Math.sin(barAngle) * along + Math.cos(barAngle) * across;
                y = gaussianRandom() * 0.42 * (0.45 + endTaper);
            } else {
                const arm = Math.floor(Math.random() * arms);
                const isInterarm = Math.random() < 0.18;
                const reach = radius * armReach[arm];
                const r = Math.pow(Math.random(), isInterarm ? 0.5 : 0.74) * (isInterarm ? radius : reach);
                const normalized = r / Math.max(1, radius);
                const winding = normalized * (4.75 + arm * 0.14);
                const organicBend = Math.sin(normalized * 18 + arm * 1.7) * 0.12 + Math.sin(normalized * 43 + arm) * 0.045;
                const scatter = gaussianRandom() * (isInterarm ? 0.24 + r * 0.012 : 0.09 + r * 0.007);
                const barAngle = -0.48;
                const theta = barAngle + armOffsets[arm] + winding + organicBend + scatter;
                x = Math.cos(theta) * r;
                z = Math.sin(theta) * r;
                y = gaussianRandom() * (0.22 + r * 0.009);
            }

            positions.push(x, y, z);
            const galacticRadius = Math.sqrt(x * x + z * z) / Math.max(1, radius);
            const color = colorOne.clone().lerp(colorTwo, Math.random() * 0.65);
            if (galacticRadius < 0.22) {
                color.lerp(new THREE.Color(0xffd79a), 0.55);
            }
            if (Math.random() < (galacticRadius > 0.28 ? 0.065 : 0.025)) {
                color.set(Math.random() > 0.48 ? 0xff6e9f : 0x8ef2ff);
            }
            const brightness = 0.52 + Math.random() * 0.68;
            color.multiplyScalar(brightness);
            colors.push(color.r, color.g, color.b);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        return new THREE.Points(geometry, new THREE.PointsMaterial({
            size,
            transparent: true,
            opacity: 0.82,
            vertexColors: true,
            depthWrite: false
        }));
    }

    const galaxyGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(96, 96),
        new THREE.MeshBasicMaterial({
            map: makeGalaxyGlowTexture(),
            transparent: true,
            opacity: 0.96,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    galaxyGlow.rotation.x = -Math.PI / 2;
    galaxyGlow.position.y = -0.28;
    groups.galaxy.add(galaxyGlow);

    const galaxyHalo = new THREE.Mesh(
        new THREE.CircleGeometry(52, 160),
        new THREE.MeshBasicMaterial({
            color: 0x7aa7ff,
            transparent: true,
            opacity: 0.012,
            depthWrite: false,
            side: THREE.DoubleSide
        })
    );
    galaxyHalo.rotation.x = -Math.PI / 2;
    galaxyHalo.position.y = -0.34;
    groups.galaxy.add(galaxyHalo);

    [15_000, 30_000, 45_000].forEach((lightYears) => {
        const ring = makeGalaxyRing(46 * (lightYears / 50_000), lightYears === 30_000 ? 0.16 : 0.1);
        ring.userData.atlasGuide = true;
        groups.galaxy.add(ring);
    });
    for (let i = 0; i < 8; i += 1) {
        const spoke = makeGalaxySpoke((i / 8) * Math.PI * 2, 46);
        spoke.userData.atlasGuide = true;
        groups.galaxy.add(spoke);
    }
    for (let i = 0; i < 4; i += 1) {
        const guide = makeSpiralArmGuide(i, 44);
        guide.userData.atlasGuide = true;
        groups.galaxy.add(guide);
    }

    const milkyWay = makeSpiralGalaxy(22000, 46, 0x9eefff, 0xffd4a8, 0.085);
    groups.galaxy.add(milkyWay);
    const galacticCenter = makeSphere(0.58, 0xfff1b5, new THREE.Vector3(0, 0, 0), {
        emissive: 0xffc861,
        emissiveIntensity: 2
    });
    groups.galaxy.add(galacticCenter);
    // Milky Way radius is represented as 46 scene units; Sun is about 26,700 ly from center in a ~100,000 ly disk.
    const sunRadiusInGalaxy = 46 * (26_700 / 50_000);
    const sunAngleInLocalArm = -1.72;
    const sunNeighborhoodPosition = new THREE.Vector3(
        Math.cos(sunAngleInLocalArm) * sunRadiusInGalaxy,
        0.35,
        Math.sin(sunAngleInLocalArm) * sunRadiusInGalaxy
    );
    const localStarsBubble = new THREE.Mesh(
        new THREE.RingGeometry(1.35, 1.42, 56),
        new THREE.MeshBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false })
    );
    localStarsBubble.rotation.x = -Math.PI / 2;
    localStarsBubble.position.copy(sunNeighborhoodPosition);
    groups.galaxy.add(localStarsBubble);
    const sunPointer = new THREE.Group();
    sunPointer.position.copy(sunNeighborhoodPosition);
    const pointerLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.08, 0),
            new THREE.Vector3(3.6, 2.6, 0)
        ]),
        new THREE.LineBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.74, depthWrite: false })
    );
    const pointerTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.55, 24),
        new THREE.MeshBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.92, depthWrite: false })
    );
    pointerTip.position.set(0, 0.08, 0);
    pointerTip.rotation.z = Math.PI;
    sunPointer.add(pointerLine, pointerTip);
    groups.galaxy.add(sunPointer);
    makeLabel('Milky Way barred spiral ~100K ly', new THREE.Vector3(0, 12, -33), '#dffbff', 3.65, 5.35, 0.78);
    makeLabel('Galactic center', new THREE.Vector3(0, 4.5, 0), '#fff1b5', 3.72, 5.25, 0.78);
    makeLabel('Sun + nearby stars - Orion Spur', sunNeighborhoodPosition.clone().add(new THREE.Vector3(4.4, 3.2, 0)), '#ffe7a3', 3.72, 5.25, 0.82);
    makeLabel('Perseus Arm', new THREE.Vector3(-18, 3, 18), '#dffbff', 3.72, 5.25, 0.68);
    makeLabel('Scutum-Centaurus Arm', new THREE.Vector3(23, 3, -18), '#dffbff', 3.72, 5.25, 0.68);
    makeLabel('Sagittarius Arm', new THREE.Vector3(-3, 3, 27), '#dffbff', 3.72, 5.25, 0.64);
    makeLabel('Outer Arm', new THREE.Vector3(32, 3, 16), '#dffbff', 3.72, 5.25, 0.62);
    makeLabel('15K ly', new THREE.Vector3(13.8, 2.5, 2), '#b8c9e8', 3.72, 5.25, 0.48);
    makeLabel('30K ly', new THREE.Vector3(27.6, 2.5, 2), '#b8c9e8', 3.72, 5.25, 0.48);
    makeLabel('45K ly', new THREE.Vector3(41.4, 2.5, 2), '#b8c9e8', 3.72, 5.25, 0.48);

    const andromeda = makePointCloud(2400, 28, 0xf2f7ff, 0xcaa1ff, 0.11, 3);
    andromeda.position.set(58, 5, -22);
    andromeda.rotation.y = 0.55;
    groups.local.add(andromeda);
    const localMilkyWay = makePointCloud(1600, 20, 0x9eefff, 0xffd4a8, 0.1, 2);
    localMilkyWay.position.set(-28, -2, 14);
    groups.local.add(localMilkyWay);
    const triangulum = makePointCloud(760, 12, 0xaedfff, 0xffd6b0, 0.095, 1.5);
    triangulum.position.set(31, -4, 33);
    triangulum.rotation.y = -0.35;
    groups.local.add(triangulum);

    function addDwarfGalaxy(position, color = 0xb8d9ff, size = 0.18) {
        const dwarf = makePointCloud(90, size * 7, color, 0xffffff, 0.08, size * 1.5);
        dwarf.position.copy(position);
        groups.local.add(dwarf);
        return dwarf;
    }

    const dwarfPositions = [
        new THREE.Vector3(-42, 4, 5),
        new THREE.Vector3(-18, -6, 35),
        new THREE.Vector3(-8, 7, -17),
        new THREE.Vector3(-54, -3, 22),
        new THREE.Vector3(45, 8, -39),
        new THREE.Vector3(70, -6, -5),
        new THREE.Vector3(48, -8, 12),
        new THREE.Vector3(20, 6, 48),
        new THREE.Vector3(-30, 10, -32),
        new THREE.Vector3(4, -9, -46),
        new THREE.Vector3(78, 2, -28),
        new THREE.Vector3(-64, 2, -9)
    ];
    dwarfPositions.forEach((position, index) => {
        addDwarfGalaxy(position, index % 3 === 0 ? 0xffd7b0 : 0xb8d9ff, index % 4 === 0 ? 0.24 : 0.16);
    });
    makeLabel('Andromeda 2.537M ly', new THREE.Vector3(58, 12, -22), '#dffbff', 4.6, 5.55);
    makeLabel('Triangulum M33', new THREE.Vector3(31, 8, 33), '#dffbff', 4.6, 5.55, 0.72);
    makeLabel('Dwarf satellites', new THREE.Vector3(-50, 11, 16), '#dffbff', 4.6, 5.55, 0.72);
    makeLabel('Local Group', new THREE.Vector3(-12, 16, 8), '#dffbff', 4.6, 5.55);

    const cosmicCloud = makePointCloud(7600, 115, 0xb68cff, 0xffb06f, 0.13, 85);
    groups.cosmic.add(cosmicCloud);
    function makeCosmicWeb() {
        const web = new THREE.Group();
        const nodes = [];
        const nodeCount = 70;

        for (let i = 0; i < nodeCount; i += 1) {
            const shell = Math.pow(Math.random(), 0.72) * 108;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(THREE.MathUtils.randFloatSpread(1.6));
            const position = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * shell,
                Math.cos(phi) * shell * 0.58,
                Math.sin(phi) * Math.sin(theta) * shell
            );
            nodes.push(position);

            const knot = new THREE.Mesh(
                new THREE.SphereGeometry(0.22 + Math.random() * 0.42, 14, 8),
                new THREE.MeshBasicMaterial({
                    color: Math.random() > 0.35 ? 0xffc06f : 0xf083ff,
                    transparent: true,
                    opacity: 0.84,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );
            knot.position.copy(position);
            web.add(knot);
        }

        nodes.forEach((node, index) => {
            const nearest = nodes
                .map((candidate, candidateIndex) => ({
                    candidate,
                    candidateIndex,
                    distance: node.distanceTo(candidate)
                }))
                .filter((item) => item.candidateIndex !== index && item.distance < 48)
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 3);

            nearest.forEach(({ candidate, candidateIndex, distance }, connectionIndex) => {
                if (candidateIndex < index && connectionIndex > 0) return;
                const midpoint = node.clone().lerp(candidate, 0.5);
                midpoint.add(new THREE.Vector3(
                    THREE.MathUtils.randFloatSpread(distance * 0.12),
                    THREE.MathUtils.randFloatSpread(distance * 0.08),
                    THREE.MathUtils.randFloatSpread(distance * 0.12)
                ));
                const curve = new THREE.CatmullRomCurve3([node, midpoint, candidate]);
                const tube = new THREE.Mesh(
                    new THREE.TubeGeometry(curve, 18, 0.025 + Math.max(0, 44 - distance) * 0.0014, 6, false),
                    new THREE.MeshBasicMaterial({
                        color: connectionIndex === 0 ? 0xff9adf : 0x8fddff,
                        transparent: true,
                        opacity: connectionIndex === 0 ? 0.46 : 0.27,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    })
                );
                web.add(tube);
            });
        });

        for (let i = 0; i < 150; i += 1) {
            const a = nodes[Math.floor(Math.random() * nodes.length)];
            const direction = new THREE.Vector3(
                THREE.MathUtils.randFloatSpread(1),
                THREE.MathUtils.randFloatSpread(0.55),
                THREE.MathUtils.randFloatSpread(1)
            ).normalize();
            const b = a.clone().add(direction.multiplyScalar(8 + Math.random() * 22));
            const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.55), b]);
            const wisp = new THREE.Mesh(
                new THREE.TubeGeometry(curve, 8, 0.012 + Math.random() * 0.012, 5, false),
                new THREE.MeshBasicMaterial({
                    color: Math.random() > 0.5 ? 0xff83d8 : 0x8bdfff,
                    transparent: true,
                    opacity: 0.18,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );
            web.add(wisp);
        }

        return web;
    }

    const cosmicWeb = makeCosmicWeb();
    groups.cosmic.add(cosmicWeb);
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(124, 96, 48),
        new THREE.MeshBasicMaterial({ color: 0x4edfff, transparent: true, opacity: 0.035, wireframe: true })
    );
    groups.cosmic.add(horizon);
    const cosmicLocalGroupAnchor = new THREE.Group();
    cosmicLocalGroupAnchor.position.set(-12, -4, 18);
    const localGroupDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.86 })
    );
    const localGroupLocator = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 0.82, 42),
        new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false })
    );
    localGroupLocator.rotation.x = -Math.PI / 2;
    cosmicLocalGroupAnchor.add(localGroupDot, localGroupLocator);
    groups.cosmic.add(cosmicLocalGroupAnchor);
    makeLabel('Local Group anchor', new THREE.Vector3(-12, 5, 18), '#ffe7a3', 5.55, 6, 0.72);

    function addCosmicContextAnchor(name, position, color = 0x8ef2ff, radius = 0.34) {
        const anchor = new THREE.Group();
        anchor.position.copy(position);
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 20, 10),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.76 })
        );
        const locator = new THREE.Mesh(
            new THREE.RingGeometry(radius * 2.2, radius * 2.45, 36),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
        );
        locator.rotation.x = -Math.PI / 2;
        anchor.add(dot, locator);
        groups.cosmic.add(anchor);
        makeLabel(name, position.clone().add(new THREE.Vector3(0, 5.5, 0)), '#dffbff', 5.55, 6, 0.62);
    }

    addCosmicContextAnchor('Virgo Cluster', new THREE.Vector3(18, 9, -26), 0x8ef2ff, 0.28);
    addCosmicContextAnchor('Fornax Cluster', new THREE.Vector3(-38, -11, -18), 0xb8d9ff, 0.24);
    addCosmicContextAnchor('Coma Cluster', new THREE.Vector3(42, 17, 22), 0xffb6dc, 0.32);
    addCosmicContextAnchor('Laniakea Supercluster', new THREE.Vector3(-2, -22, 42), 0xffd48a, 0.4);
    addCosmicContextAnchor('Shapley Supercluster', new THREE.Vector3(70, -8, -48), 0xff73de, 0.48);
    addCosmicContextAnchor('Sloan Great Wall', new THREE.Vector3(-72, 18, 58), 0x73e3ff, 0.42);

    makeLabel('Observable Universe ~93B ly wide', new THREE.Vector3(0, 62, 0), '#dffbff', 5.4, 6);

    function updateVisibility() {
        const zoom = currentZoom;
        const stopIndex = nearestStopIndex(zoom);
        const showEarthMoon = stopIndex <= 1;
        const showSolarSystem = stopIndex === 2;
        groups.earth.visible = showEarthMoon;
        groups.solar.visible = showSolarSystem;
        groups.stars.visible = zoom >= 2.7 && zoom < 3.72;
        groups.galaxy.visible = zoom >= 3.72 && zoom < 5.35;
        groups.local.visible = zoom >= 4.6 && zoom < 5.55;
        groups.cosmic.visible = zoom >= 5.4;
        if (solarScaleSelect) {
            const solarControl = solarScaleSelect.closest('.solar-scale-control');
            if (solarControl) {
                solarControl.classList.toggle('muted', !showSolarSystem);
            }
        }
        if (earthSurfaceLaunch) {
            earthSurfaceLaunch.classList.toggle('is-visible', showEarthMoon);
        }

        groups.solar.children.forEach((child) => {
            if (child.userData.isOrbit) child.visible = activeMode !== 'structure';
        });
        cosmicCloud.visible = activeMode !== 'orbits';
        horizon.visible = activeMode !== 'orbits';
        milkyWay.material.opacity = activeMode === 'structure' ? 0.95 : 0.72;
        groups.galaxy.children.forEach((child) => {
            if (child.userData.atlasGuide) {
                child.visible = activeMode === 'structure';
            }
        });
        labelSprites.forEach((sprite) => {
            sprite.visible = currentZoom >= sprite.userData.minZoom && currentZoom <= sprite.userData.maxZoom;
        });
        earthLabel.visible = showEarthMoon && currentZoom >= earthLabel.userData.minZoom && currentZoom <= earthLabel.userData.maxZoom;
        moonLabel.visible = showEarthMoon && currentZoom >= moonLabel.userData.minZoom && currentZoom <= moonLabel.userData.maxZoom;
        solarPlanetEntries.forEach((entry) => {
            if (entry.label) {
                entry.label.visible = showSolarSystem && currentZoom >= entry.label.userData.minZoom && currentZoom <= entry.label.userData.maxZoom;
            }
        });
    }

    function nearestStopIndex(value) {
        return Math.max(0, Math.min(stops.length - 1, Math.round(value)));
    }

    function updateReadouts() {
        const lower = Math.floor(currentZoom);
        const upper = Math.min(stops.length - 1, lower + 1);
        const mix = currentZoom - lower;
        const stop = stops[nearestStopIndex(currentZoom)];
        const scaleKm = THREE.MathUtils.lerp(stops[lower].scale, stops[upper].scale, mix);
        title.textContent = stop.label;
        description.textContent = stop.description;
        zoomValue.textContent = stop.label;
        scaleReadout.textContent = formatDistance(scaleKm);
        distanceReadout.textContent = formatDistance(stop.distance);
        if (contextNote) {
            if (stop.id === 'observable') {
                contextNote.textContent = 'Observable-universe filaments and distant structure anchors are illustrative context, not precise survey coordinates.';
            } else if (stop.id === 'local-group') {
                contextNote.textContent = 'Local Group view includes major galaxies plus simplified dwarf satellite markers.';
            } else {
                contextNote.textContent = '';
            }
        }
        if (stopSelect.value !== stop.id) {
            stopSelect.value = stop.id;
        }
    }

    function setZoom(value) {
        currentZoom = THREE.MathUtils.clamp(value, 0, stops.length - 1);
        cameraTransitionFrames = 80;
        scaleTransitionLock = null;
        zoomInput.value = currentZoom.toFixed(2);
        updateVisibility();
        updateReadouts();
    }

    function saveCurrentView() {
        savedViews.set(nearestStopIndex(currentZoom), {
            camera: camera.position.clone(),
            target: controls.target.clone()
        });
    }

    function restoreSavedView(index) {
        const savedView = savedViews.get(index);
        if (!savedView) return false;
        camera.position.copy(savedView.camera);
        controls.target.copy(savedView.target);
        controls.update();
        return true;
    }

    function transitionToStop(index) {
        const fromIndex = nearestStopIndex(currentZoom);
        const nextIndex = THREE.MathUtils.clamp(index, 0, stops.length - 1);
        if (nextIndex === fromIndex) return;
        saveCurrentView();
        lastScaleTransitionAt = performance.now();
        setZoom(nextIndex);
        scaleTransitionLock = {
            fromIndex,
            toIndex: nextIndex,
            direction: Math.sign(nextIndex - fromIndex)
        };
        if (restoreSavedView(nextIndex)) {
            cameraTransitionFrames = 0;
        }
    }

    function canAutoTransition(stopIndex, cameraRatio, direction) {
        if (!scaleTransitionLock || scaleTransitionLock.toIndex !== stopIndex) return true;

        const neutralLow = 0.74;
        const neutralHigh = 1.26;
        const returnedToNeutralBand = cameraRatio > neutralLow && cameraRatio < neutralHigh;

        if (returnedToNeutralBand) {
            scaleTransitionLock = null;
            return true;
        }

        return direction !== -scaleTransitionLock.direction;
    }

    function handleScaleZoomTransitions() {
        if (cameraTransitionFrames > 0) return;
        if (performance.now() - lastScaleTransitionAt < 900) return;

        const stopIndex = nearestStopIndex(currentZoom);
        const stopDistance = stops[stopIndex].camera.distanceTo(stops[stopIndex].target);
        const cameraDistance = camera.position.distanceTo(controls.target);
        const cameraRatio = cameraDistance / stopDistance;
        const largerScaleThreshold = stopIndex === 5 ? 1.42 : 1.58;
        const smallerScaleThresholds = [0.42, 0.36, 0.3, 0.28, 0.16, 0.18, 0.22];
        const smallerScaleThreshold = smallerScaleThresholds[stopIndex] || 0.3;

        if (
            stopIndex === 4 &&
            controls.target.distanceTo(sunNeighborhoodPosition) < 3.2 &&
            cameraDistance < 9
        ) {
            if (!canAutoTransition(stopIndex, cameraRatio, -1)) return;
            transitionToStop(2);
            return;
        }

        if (cameraRatio > largerScaleThreshold && stopIndex < stops.length - 1) {
            if (!canAutoTransition(stopIndex, cameraRatio, 1)) return;
            transitionToStop(stopIndex + 1);
            return;
        }

        if (cameraRatio < smallerScaleThreshold && stopIndex > 0) {
            if (!canAutoTransition(stopIndex, cameraRatio, -1)) return;
            transitionToStop(stopIndex - 1);
        }
    }

    function setEarthSurfaceStatus(message) {
        if (!earthSurfaceStatus) return;
        earthSurfaceStatus.textContent = message || '';
    }

    function loadExternalStylesheet(href, id) {
        if (document.getElementById(id)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }

    function loadExternalScript(src, id) {
        if (document.getElementById(id)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = id;
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function loadCesium() {
        window.CESIUM_BASE_URL = window.CESIUM_BASE_URL || 'https://cdn.jsdelivr.net/npm/cesium@1.118.2/Build/Cesium/';
        await loadExternalStylesheet('https://cdn.jsdelivr.net/npm/cesium@1.118.2/Build/Cesium/Widgets/widgets.css', 'cesium-widgets-css');
        await loadExternalScript('https://cdn.jsdelivr.net/npm/cesium@1.118.2/Build/Cesium/Cesium.js', 'cesium-main-js');
    }

    function attachEarthSurfaceControls(Cesium) {
        if (!earthSurfaceMap || !earthSurfaceWidget || earthSurfaceMap.dataset.controlsAttached === 'true') return;
        earthSurfaceMap.dataset.controlsAttached = 'true';
        const camera = earthSurfaceWidget.camera;
        const scene = earthSurfaceWidget.scene;
        const activePointers = new Map();
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let lastPinchDistance = 0;
        let lastPinchCenter = null;

        function requestRender() {
            if (scene.requestRender) scene.requestRender();
        }

        function cameraHeight() {
            return Math.max(camera.positionCartographic.height || 1_000, 350);
        }

        earthSurfaceMap.addEventListener('wheel', (event) => {
            event.preventDefault();
            const amount = cameraHeight() * Math.min(0.45, Math.max(0.08, Math.abs(event.deltaY) / 1600));
            if (event.deltaY > 0) {
                camera.zoomOut(amount);
            } else {
                camera.zoomIn(amount);
            }
            requestRender();
        }, { passive: false });

        earthSurfaceMap.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            dragging = activePointers.size === 1;
            lastX = event.clientX;
            lastY = event.clientY;
            earthSurfaceMap.setPointerCapture(event.pointerId);
            earthSurfaceMap.classList.add('is-dragging');
            if (activePointers.size === 2) {
                const points = Array.from(activePointers.values());
                lastPinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                lastPinchCenter = {
                    x: (points[0].x + points[1].x) / 2,
                    y: (points[0].y + points[1].y) / 2
                };
            }
        });

        earthSurfaceMap.addEventListener('pointermove', (event) => {
            if (!activePointers.has(event.pointerId)) return;
            event.preventDefault();
            activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (activePointers.size >= 2) {
                const points = Array.from(activePointers.values()).slice(0, 2);
                const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                const center = {
                    x: (points[0].x + points[1].x) / 2,
                    y: (points[0].y + points[1].y) / 2
                };
                if (lastPinchDistance > 0) {
                    const delta = distance - lastPinchDistance;
                    const amount = cameraHeight() * Math.min(0.28, Math.abs(delta) / 520);
                    if (delta > 0) {
                        camera.zoomIn(amount);
                    } else if (delta < 0) {
                        camera.zoomOut(amount);
                    }
                    if (lastPinchCenter) {
                        const dx = center.x - lastPinchCenter.x;
                        const dy = center.y - lastPinchCenter.y;
                        camera.rotateLeft(dx * 0.0015);
                        camera.rotateUp(dy * 0.0015);
                    }
                    requestRender();
                }
                lastPinchDistance = distance;
                lastPinchCenter = center;
                return;
            }
            if (!dragging) return;
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            const height = cameraHeight();
            if (height > 1_200_000) {
                camera.rotateLeft(dx * 0.0022);
                camera.rotateUp(dy * 0.0022);
            } else {
                const moveScale = height * 0.0016;
                camera.moveRight(-dx * moveScale);
                camera.moveUp(dy * moveScale);
            }
            requestRender();
        }, { passive: false });

        function endDrag(event) {
            activePointers.delete(event.pointerId);
            dragging = activePointers.size === 1;
            if (!dragging) {
                earthSurfaceMap.classList.remove('is-dragging');
            }
            if (activePointers.size < 2) {
                lastPinchDistance = 0;
                lastPinchCenter = null;
            }
            if (earthSurfaceMap.hasPointerCapture(event.pointerId)) {
                earthSurfaceMap.releasePointerCapture(event.pointerId);
            }
        }

        earthSurfaceMap.addEventListener('pointerup', endDrag);
        earthSurfaceMap.addEventListener('pointercancel', endDrag);
        earthSurfaceMap.addEventListener('lostpointercapture', (event) => {
            activePointers.delete(event.pointerId);
            dragging = activePointers.size === 1;
            if (activePointers.size < 2) {
                lastPinchDistance = 0;
                lastPinchCenter = null;
            }
            if (!dragging) {
                earthSurfaceMap.classList.remove('is-dragging');
            }
        });
    }

    async function getMapsConfig() {
        const browserKey = window.MICROCOMP_GOOGLE_MAPS_API_KEY || window.GOOGLE_MAPS_TILE_API_KEY || '';
        if (browserKey) {
            return { enabled: true, googleMapsApiKey: browserKey };
        }
        try {
            const response = await fetch('/api/maps/config', { cache: 'no-store' });
            if (!response.ok) return { enabled: false, googleMapsApiKey: '' };
            return await response.json();
        } catch (error) {
            return { enabled: false, googleMapsApiKey: '' };
        }
    }

    async function initializeEarthSurface() {
        if (earthSurfaceWidget || earthSurfaceLoading || !earthSurfaceMap) return;
        earthSurfaceLoading = true;
        setEarthSurfaceStatus('Loading Earth surface...');
        try {
            const config = await getMapsConfig();
            if (!config.enabled || !config.googleMapsApiKey) {
                setEarthSurfaceStatus('Set GOOGLE_MAPS_TILE_API_KEY or GOOGLE_MAPS_API_KEY on the server to enable Google Photorealistic 3D Tiles.');
                return;
            }

            await loadCesium();
            const Cesium = window.Cesium;
            Cesium.Ion.defaultAccessToken = '';
            earthSurfaceWidget = new Cesium.CesiumWidget(earthSurfaceMap, {
                scene3DOnly: true,
                requestRenderMode: false,
                useDefaultRenderLoop: true
            });
            earthSurfaceWidget.scene.globe.show = true;
            earthSurfaceWidget.scene.globe.baseColor = Cesium.Color.fromCssColorString('#071a33');
            earthSurfaceWidget.scene.skyAtmosphere.show = true;
            earthSurfaceWidget.scene.screenSpaceCameraController.enableCollisionDetection = true;
            earthSurfaceWidget.scene.screenSpaceCameraController.enableInputs = false;
            earthSurfaceWidget.scene.screenSpaceCameraController.minimumZoomDistance = 350;
            earthSurfaceWidget.scene.screenSpaceCameraController.maximumZoomDistance = 42_000_000;
            earthSurfaceWidget.scene.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(-98.5795, 39.8283, 19_000_000),
                orientation: {
                    heading: 0,
                    pitch: Cesium.Math.toRadians(-90),
                    roll: 0
                }
            });

            earthSurfaceTileset = await Cesium.Cesium3DTileset.fromUrl(
                `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(config.googleMapsApiKey)}`,
                { showCreditsOnScreen: true }
            );
            earthSurfaceWidget.scene.primitives.add(earthSurfaceTileset);
            attachEarthSurfaceControls(Cesium);
            setEarthSurfaceStatus('');
        } catch (error) {
            setEarthSurfaceStatus('Earth surface tiles could not be loaded. Check the Maps tile API key, billing, and browser console details.');
            console.error('Earth surface initialization failed:', error);
        } finally {
            earthSurfaceLoading = false;
        }
    }

    function openEarthSurface() {
        if (!earthSurfaceOverlay) return;
        earthSurfaceOverlay.hidden = false;
        initializeEarthSurface();
    }

    function closeEarthSurface() {
        if (!earthSurfaceOverlay) return;
        earthSurfaceOverlay.hidden = true;
    }

    zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
    stopSelect.addEventListener('change', () => {
        const index = stops.findIndex((stop) => stop.id === stopSelect.value);
        if (index >= 0) setZoom(index);
    });
    if (earthSurfaceLaunch) {
        earthSurfaceLaunch.addEventListener('click', openEarthSurface);
    }
    if (earthSurfaceClose) {
        earthSurfaceClose.addEventListener('click', closeEarthSurface);
    }
    if (solarScaleSelect) {
        solarScaleSelect.addEventListener('change', applySolarScaleMode);
    }
    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            activeMode = button.dataset.universeMode;
            modeButtons.forEach((item) => item.classList.toggle('active', item === button));
            updateVisibility();
        });
    });

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener('resize', resize);
    resize();
    applySolarScaleMode();
    setZoom(currentZoom);

    function animate() {
        requestAnimationFrame(animate);
        const lower = Math.floor(currentZoom);
        const upper = Math.min(stops.length - 1, lower + 1);
        const mix = currentZoom - lower;
        const desiredCamera = stops[lower].camera.clone().lerp(stops[upper].camera, mix);
        if (cameraTransitionFrames > 0) {
            camera.position.lerp(desiredCamera, 0.055);
            controls.target.lerp(stops[nearestStopIndex(currentZoom)].target, 0.07);
            cameraTransitionFrames -= 1;
        }
        const time = performance.now() * 0.001;
        earth.rotation.y = time * 0.22;
        atmosphere.rotation.y = time * 0.16;
        moon.position.set(Math.cos(time * 0.18) * moonDistance, Math.sin(time * 0.18) * moonDistance, 0);
        earthLabel.position.set(0, 2.75, 0);
        moonLabel.position.copy(moon.position).add(new THREE.Vector3(1.2, 1.35, 0));
        groups.solar.rotation.y = 0;
        groups.galaxy.rotation.y = 0;
        groups.local.rotation.y = time * 0.006;
        groups.cosmic.rotation.y = time * 0.0025;

        labelSprites.forEach((sprite) => {
            const distance = camera.position.distanceTo(sprite.position);
            const scale = THREE.MathUtils.clamp(distance / 34, 0.8, 2.5);
            sprite.scale.copy(sprite.userData.baseScale).multiplyScalar(scale);
        });

        controls.update();
        handleScaleZoomTransitions();
        renderer.render(scene, camera);
    }

    animate();
}

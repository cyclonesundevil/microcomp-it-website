import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('lensing-3d-scene');

if (container) {
    const sliders = {
        mass: document.querySelector('[data-lensing-control="mass"]'),
        sourceDistance: document.querySelector('[data-lensing-control="sourceDistance"]'),
        observerDistance: document.querySelector('[data-lensing-control="observerDistance"]'),
        alignment: document.querySelector('[data-lensing-control="alignment"]'),
        frequency: document.querySelector('[data-lensing-control="frequency"]')
    };
    const allSliders = Array.from(document.querySelectorAll('[data-lensing-control]'));
    const modeButtons = Array.from(container.parentElement.querySelectorAll('[data-3d-mode]'));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040a);
    scene.fog = new THREE.Fog(0x02040a, 9, 24);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
    camera.position.set(1.8, 4.4, 10.5);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5.8;
    controls.maxDistance = 18;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x8fbfff, 0.65));

    const cyanLight = new THREE.PointLight(0x00f0ff, 2.8, 18);
    cyanLight.position.set(-4, 5, 3);
    scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xff00ff, 1.8, 18);
    magentaLight.position.set(4, -2, -4);
    scene.add(magentaLight);

    const root = new THREE.Group();
    scene.add(root);

    const starPositions = [];
    for (let i = 0; i < 520; i += 1) {
        starPositions.push(
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 18,
            (Math.random() - 0.5) * 30
        );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
            color: 0x8ee8ff,
            size: 0.03,
            transparent: true,
            opacity: 0.5
        })
    );
    root.add(stars);

    const source = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 32, 16),
        new THREE.MeshStandardMaterial({
            color: 0xff2aff,
            emissive: 0xff00ff,
            emissiveIntensity: 2.3
        })
    );
    root.add(source);

    const lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 48, 24),
        new THREE.MeshPhysicalMaterial({
            color: 0x00f0ff,
            emissive: 0x006f7f,
            emissiveIntensity: 1.6,
            roughness: 0.18,
            metalness: 0.05
        })
    );
    root.add(lens);

    const lensHalo = new THREE.Mesh(
        new THREE.SphereGeometry(1.25, 64, 32),
        new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
            side: THREE.BackSide
        })
    );
    root.add(lensHalo);

    const observer = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 32, 16),
        new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 1.2
        })
    );
    root.add(observer);

    const lensPlane = new THREE.GridHelper(5.6, 18, 0x00f0ff, 0x164256);
    lensPlane.rotation.x = Math.PI / 2;
    lensPlane.material.transparent = true;
    lensPlane.material.opacity = 0.24;
    root.add(lensPlane);

    const einsteinRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.018, 12, 120),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.72
        })
    );
    einsteinRing.rotation.y = Math.PI / 2;
    root.add(einsteinRing);

    const dominantMaterial = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
    });
    const secondaryMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.82,
        depthWrite: false
    });

    let dominantPath = null;
    let secondaryPath = null;
    let currentMode = 'wave';
    const wavefronts = [];

    for (let i = 0; i < 9; i += 1) {
        const wave = new THREE.Mesh(
            new THREE.TorusGeometry(0.42 + i * 0.08, 0.01, 8, 88),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0x8ffaff : 0x00f0ff,
                transparent: true,
                opacity: 0.42,
                depthWrite: false
            })
        );
        wave.rotation.y = Math.PI / 2;
        wavefronts.push(wave);
        root.add(wave);
    }

    function readMode() {
        return container.parentElement.querySelector('[data-3d-mode].active')?.dataset.mode || 'wave';
    }

    function applyModeVisuals() {
        currentMode = readMode();
        const waveMode = currentMode === 'wave';
        dominantMaterial.opacity = waveMode ? 0.42 : 0.94;
        secondaryMaterial.opacity = waveMode ? 0.36 : 0.82;
        lensPlane.material.opacity = waveMode ? 0.12 : 0.24;
        einsteinRing.material.opacity = waveMode ? 0.96 : 0.68;
        lensHalo.material.opacity = waveMode ? 0.15 : 0.08;
        wavefronts.forEach((wave) => {
            wave.visible = waveMode;
        });
    }

    function currentState() {
        const mass = Number(sliders.mass?.value || 45);
        const sourceDistance = Number(sliders.sourceDistance?.value || 60) / 10;
        const observerDistance = Number(sliders.observerDistance?.value || 40) / 10;
        const alignment = Number(sliders.alignment?.value || 32) / 100;
        const frequency = Number(sliders.frequency?.value || 1400);
        const distanceRatio = Math.sqrt((sourceDistance * observerDistance) / (sourceDistance + observerDistance));
        const einstein = Math.sqrt(mass / 80) * distanceRatio * 0.55;
        return { mass, sourceDistance, observerDistance, alignment, frequency, einstein };
    }

    function makeTube(points, material) {
        const curve = new THREE.CatmullRomCurve3(points);
        return new THREE.Mesh(
            new THREE.TubeGeometry(curve, 96, 0.025, 10, false),
            material
        );
    }

    function rebuildPaths(state) {
        if (dominantPath) {
            dominantPath.geometry.dispose();
            root.remove(dominantPath);
        }
        if (secondaryPath) {
            secondaryPath.geometry.dispose();
            root.remove(secondaryPath);
        }

        const src = source.position;
        const obs = observer.position;
        const bend = Math.min(2.2, 0.6 + state.mass / 75);
        const offset = 0.75 + state.alignment * 1.45;

        dominantPath = makeTube([
            new THREE.Vector3(src.x, src.y, src.z),
            new THREE.Vector3(-2.5, offset, bend * 0.22),
            new THREE.Vector3(-0.55, offset * 0.62, bend * 0.72),
            new THREE.Vector3(0.55, offset * 0.5, bend * 0.42),
            new THREE.Vector3(obs.x, obs.y, obs.z)
        ], dominantMaterial);

        secondaryPath = makeTube([
            new THREE.Vector3(src.x, src.y, src.z),
            new THREE.Vector3(-2.4, -offset * 0.92, -bend * 0.2),
            new THREE.Vector3(-0.45, -offset * 0.66, -bend * 0.58),
            new THREE.Vector3(0.6, -offset * 0.5, -bend * 0.25),
            new THREE.Vector3(obs.x, obs.y, obs.z)
        ], secondaryMaterial);

        root.add(dominantPath, secondaryPath);
    }

    function updateScene() {
        applyModeVisuals();
        const state = currentState();
        const sourceX = -Math.max(4.2, state.sourceDistance * 0.9);
        const observerX = Math.max(4.2, state.observerDistance * 1.15);
        const alignY = (state.alignment - 0.5) * 1.35;

        source.position.set(sourceX, alignY, -0.55);
        observer.position.set(observerX, 0, 0.55);
        lens.scale.setScalar(0.85 + state.mass / 130);
        lensHalo.scale.setScalar(0.8 + state.mass / 100);
        lensPlane.scale.setScalar(0.88 + state.einstein * 0.18);
        einsteinRing.scale.setScalar(0.82 + state.einstein * 0.34);

        rebuildPaths(state);
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(360, Math.floor(rect.height));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }

    function animate(now) {
        const time = now * 0.001;
        const state = currentState();
        const span = observer.position.x - source.position.x;
        const waveMode = currentMode === 'wave';

        wavefronts.forEach((wave, index) => {
            const travel = ((time * (0.32 + state.frequency / 7000) + index * 0.62) % 1);
            const x = source.position.x + span * travel;
            const wobble = Math.sin(time * 4.4 + index * 0.75) * state.alignment * 0.08;
            const radius = 0.25 + travel * (1.15 + state.einstein * 0.28);
            wave.position.set(x, source.position.y * (1 - travel), source.position.z * (1 - travel) + wobble);
            wave.scale.set(radius, radius, radius);
            wave.material.opacity = waveMode
                ? 0.1 + (1 - Math.abs(travel - 0.5) * 1.6) * 0.32
                : 0;
            wave.material.color.setHex(index % 2 ? 0x8ffaff : 0x00f0ff);
        });

        lens.rotation.y += 0.006;
        lensHalo.rotation.y -= 0.002;
        einsteinRing.rotation.z = Math.sin(time * (waveMode ? 1.6 : 0.7)) * (waveMode ? 0.11 : 0.05);
        einsteinRing.scale.z = waveMode ? 1 + Math.sin(time * 3.2) * 0.03 : 1;
        stars.rotation.y += 0.0008;
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }

    allSliders.forEach((slider) => {
        slider.addEventListener('input', updateScene);
    });
    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            modeButtons.forEach((item) => item.classList.toggle('active', item === button));
            window.setTimeout(updateScene, 0);
        });
    });
    window.addEventListener('lensing-controls-change', updateScene);

    window.addEventListener('resize', resize);
    resize();
    updateScene();
    requestAnimationFrame(animate);
}

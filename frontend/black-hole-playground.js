import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    const readouts = {
        time: document.getElementById('bh-time-readout'),
        lensing: document.getElementById('bh-lensing-readout'),
        redshift: document.getElementById('bh-redshift-readout')
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040a);
    scene.fog = new THREE.Fog(0x02040a, 12, 36);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 90);
    camera.position.set(0, 5.6, 15.5);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 7;
    controls.maxDistance = 22;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x8aa7ff, 0.36));

    const rimLight = new THREE.PointLight(0xffcc7a, 3.2, 28);
    rimLight.position.set(-5, 4, 7);
    scene.add(rimLight);

    const blueLight = new THREE.PointLight(0x2de5ff, 1.7, 24);
    blueLight.position.set(5, -2, -5);
    scene.add(blueLight);

    const root = new THREE.Group();
    scene.add(root);
    const accretionGroup = new THREE.Group();
    const lensingGroup = new THREE.Group();
    const wellGroup = new THREE.Group();
    accretionGroup.position.x = 0.65;
    lensingGroup.position.x = 1.05;
    wellGroup.position.x = 0.75;
    root.add(accretionGroup, lensingGroup, wellGroup);
    let activeMode = 'disk';

    const starPositions = [];
    const starColors = [];
    for (let i = 0; i < 920; i += 1) {
        starPositions.push(
            (Math.random() - 0.5) * 42,
            (Math.random() - 0.5) * 26,
            (Math.random() - 0.5) * 42
        );
        const cool = Math.random() > 0.72;
        starColors.push(cool ? 0.5 : 0.75, cool ? 0.88 : 0.72, 1);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    const stars = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
            size: 0.035,
            transparent: true,
            opacity: 0.78,
            vertexColors: true
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
            color: 0x121827,
            transparent: true,
            opacity: 0.36,
            depthWrite: false,
            side: THREE.BackSide
        })
    );
    accretionGroup.add(shadowGlow);

    const photonRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.84, 0.045, 18, 160),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.82
        })
    );
    accretionGroup.add(photonRing);

    const diskGroup = new THREE.Group();
    accretionGroup.add(diskGroup);

    function makeDiskHalf(startAngle, endAngle, color, opacity) {
        return new THREE.Mesh(
            new THREE.RingGeometry(2.02, 4.35, 180, 1, startAngle, endAngle),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
    }

    const hotDisk = makeDiskHalf(-Math.PI * 0.08, Math.PI * 1.08, 0xffd36a, 0.74);
    const redDisk = makeDiskHalf(Math.PI * 0.92, Math.PI * 1.08, 0xff365d, 0.48);
    diskGroup.add(hotDisk, redDisk);

    const innerGlow = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.08, 20, 180),
        new THREE.MeshBasicMaterial({
            color: 0xfff0aa,
            transparent: true,
            opacity: 0.78,
            depthWrite: false
        })
    );
    accretionGroup.add(innerGlow);

    const lensArcGroup = new THREE.Group();
    accretionGroup.add(lensArcGroup);
    const lensArcs = [];
    for (let i = 0; i < 5; i += 1) {
        const arc = new THREE.Mesh(
            new THREE.TorusGeometry(2.65 + i * 0.46, 0.012, 8, 144, Math.PI * (0.72 + i * 0.04)),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0xff7aa8 : 0x5ee7ff,
                transparent: true,
                opacity: 0.25,
                depthWrite: false
            })
        );
        arc.rotation.z = -0.25 + i * 0.13;
        lensArcs.push(arc);
        lensArcGroup.add(arc);
    }

    function makeLensingTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#05070d');
        gradient.addColorStop(0.36, '#1b2634');
        gradient.addColorStop(0.48, '#cbd6df');
        gradient.addColorStop(0.52, '#ffd18a');
        gradient.addColorStop(0.66, '#213041');
        gradient.addColorStop(1, '#05060c');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < 2400; i += 1) {
            const x = Math.random() * canvas.width;
            const y = canvas.height * (0.38 + Math.random() * 0.24) + (Math.random() - 0.5) * 90;
            const alpha = Math.random() * 0.5;
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.fillRect(x, y, Math.random() * 2.2, Math.random() * 1.4);
        }

        ctx.globalCompositeOperation = 'source-over';
        const vignette = ctx.createRadialGradient(512, 256, 80, 512, 256, 520);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.68)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return new THREE.CanvasTexture(canvas);
    }

    const lensBackdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(10.5, 5.2, 80, 28),
        new THREE.MeshBasicMaterial({
            map: makeLensingTexture(),
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide
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
            color: 0xd8f7ff,
            transparent: true,
            opacity: 0.9
        })
    );
    lensingGroup.add(lensHalo);

    const lensBands = [];
    for (let i = 0; i < 8; i += 1) {
        const band = new THREE.Mesh(
            new THREE.TorusGeometry(1.85 + i * 0.22, 0.012, 8, 180, Math.PI * (1.1 - i * 0.035)),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0xffd48a : 0x8bdfff,
                transparent: true,
                opacity: 0.24,
                depthWrite: false
            })
        );
        band.rotation.z = Math.PI * 0.02 * i;
        lensBands.push(band);
        lensingGroup.add(band);
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

    let wellMesh = new THREE.Mesh(
        makeWellGeometry(),
        new THREE.MeshBasicMaterial({
            color: 0xd9c98f,
            transparent: true,
            opacity: 0.24,
            wireframe: true
        })
    );
    wellMesh.rotation.x = -0.18;
    wellGroup.add(wellMesh);

    const wellHorizon = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.035, 12, 120),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.82
        })
    );
    wellHorizon.rotation.x = Math.PI / 2;
    wellGroup.add(wellHorizon);

    const wellColumn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.48, 4.8, 36, 1, true),
        new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.18,
            wireframe: true
        })
    );
    wellColumn.position.y = -2.25;
    wellGroup.add(wellColumn);

    const wellOrbit = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.018, 8, 160),
        new THREE.MeshBasicMaterial({
            color: 0xffd36a,
            transparent: true,
            opacity: 0.9
        })
    );
    wellOrbit.rotation.x = Math.PI / 2.25;
    wellGroup.add(wellOrbit);

    function state() {
        const mass = Number(inputs.mass.value);
        const spin = Number(inputs.spin.value) / 100;
        const angle = Number(inputs.angle.value);
        const massScale = (mass - 8) / 82;
        const angleScale = angle / 85;
        const timeDilation = 1 + massScale * 2.8 + spin * 0.95;
        const lensing = 1 + massScale * 1.35 + angleScale * 0.65;
        const redshift = 0.08 + massScale * 0.52 + spin * angleScale * 0.55;
        return { mass, spin, angle, massScale, angleScale, timeDilation, lensing, redshift };
    }

    function update() {
        const model = state();

        labels.mass.textContent = `${model.mass} solar masses`;
        labels.spin.textContent = `${model.spin.toFixed(2)} a`;
        labels.angle.textContent = `${model.angle} degrees`;

        readouts.time.textContent = `${model.timeDilation.toFixed(2)}x`;
        readouts.lensing.textContent = model.lensing.toFixed(2);
        readouts.redshift.textContent = `${model.redshift.toFixed(2)} z`;

        const horizonScale = 0.86 + model.massScale * 0.5;
        horizon.scale.setScalar(horizonScale);
        shadowGlow.scale.setScalar(1 + model.massScale * 0.55);
        photonRing.scale.setScalar(0.88 + model.lensing * 0.17);
        innerGlow.scale.setScalar(0.92 + model.spin * 0.22);
        diskGroup.scale.set(1 + model.massScale * 0.18, 1 + model.spin * 0.12, 1);
        diskGroup.rotation.x = THREE.MathUtils.degToRad(66 - model.angle * 0.55);
        lensArcGroup.scale.setScalar(0.9 + model.lensing * 0.18);
        lensArcs.forEach((arc, index) => {
            arc.material.opacity = 0.12 + model.lensing * 0.08 - index * 0.01;
        });

        hotDisk.material.opacity = 0.58 + model.spin * 0.24;
        hotDisk.material.color.setHSL(0.11 - model.redshift * 0.025, 1, 0.62);
        redDisk.material.opacity = 0.34 + model.redshift * 0.3;
        redDisk.material.color.setHSL(0.98, 0.95, Math.max(0.34, 0.58 - model.redshift * 0.15));

        lensShadow.scale.setScalar(0.92 + model.massScale * 0.44);
        lensHalo.scale.setScalar(0.9 + model.lensing * 0.22);
        lensBackdrop.scale.set(1 + model.lensing * 0.06, 1 + model.angleScale * 0.06, 1);
        lensBackdrop.rotation.z = THREE.MathUtils.degToRad((model.angle - 48) * 0.08);
        lensBands.forEach((band, index) => {
            band.scale.set(1 + model.lensing * 0.08, 0.72 + model.angleScale * 0.26, 1);
            band.material.opacity = 0.12 + model.lensing * 0.055 - index * 0.006;
        });

        wellMesh.geometry.dispose();
        wellMesh.geometry = makeWellGeometry(2.25 + model.massScale * 2.1, model.spin * 2.2);
        wellMesh.scale.setScalar(0.9 + model.lensing * 0.06);
        wellHorizon.scale.setScalar(0.92 + model.massScale * 0.45);
        wellColumn.scale.set(1 + model.spin * 0.35, 1 + model.massScale * 0.28, 1 + model.spin * 0.35);
        wellOrbit.scale.setScalar(0.88 + model.lensing * 0.18);
    }

    function setMode(mode) {
        activeMode = mode;
        accretionGroup.visible = mode === 'disk';
        lensingGroup.visible = mode === 'lensing';
        wellGroup.visible = mode === 'well';
        modeButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.bhMode === mode);
        });
        if (mode === 'well') {
            controls.target.set(0, -0.65, 0);
        } else {
            controls.target.set(0, 0, 0);
        }
        resize();
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(420, Math.floor(rect.height));
        const narrow = width < 620;
        camera.position.z = activeMode === 'well' ? (narrow ? 14.5 : 12.5) : (narrow ? 18.5 : 15.5);
        camera.position.y = activeMode === 'well' ? (narrow ? 6.2 : 6.8) : (narrow ? 5.2 : 5.6);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        root.scale.setScalar(activeMode === 'well' ? (narrow ? 0.72 : 0.86) : (narrow ? 0.76 : 0.9));
        renderer.setSize(width, height, false);
    }

    function animate(now) {
        const model = state();
        const time = now * 0.001;

        diskGroup.rotation.z += 0.003 + model.spin * 0.012;
        innerGlow.rotation.z -= 0.004 + model.spin * 0.01;
        photonRing.rotation.z = Math.sin(time * 0.8) * 0.045;
        lensArcGroup.rotation.z += 0.0015 + model.spin * 0.002;
        lensHalo.rotation.z -= 0.003 + model.spin * 0.004;
        lensBands.forEach((band, index) => {
            band.rotation.z += 0.0007 + index * 0.00008;
        });
        wellOrbit.rotation.z += 0.004 + model.spin * 0.008;
        wellColumn.rotation.y += 0.003;
        stars.rotation.y += 0.0004;
        shadowGlow.material.opacity = 0.25 + Math.sin(time * 1.2) * 0.03 + model.massScale * 0.08;

        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }

    Object.values(inputs).forEach((input) => {
        input.addEventListener('input', update);
    });

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => setMode(button.dataset.bhMode));
    });

    window.addEventListener('resize', resize);
    setMode(activeMode);
    resize();
    update();
    requestAnimationFrame(animate);
}

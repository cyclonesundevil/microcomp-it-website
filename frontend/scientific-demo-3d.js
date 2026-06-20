import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const container = document.getElementById('phase-3d-scene');

if (container) {
    const controls = {
        delay: document.getElementById('delay-slider'),
        frequency: document.getElementById('frequency-slider'),
        bandwidth: document.getElementById('bandwidth-slider'),
        plasma: document.getElementById('plasma-slider'),
        zoom: document.getElementById('zoom-slider')
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040a);
    scene.fog = new THREE.Fog(0x02040a, 8, 18);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
    camera.position.set(0, 1.7, 9);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x6fb7ff, 0.7);
    const key = new THREE.PointLight(0x00f0ff, 2.5, 16);
    key.position.set(-4, 4, 4);
    const rim = new THREE.PointLight(0xff00ff, 2.2, 16);
    rim.position.set(4, -2, -4);
    scene.add(ambient, key, rim);

    const group = new THREE.Group();
    scene.add(group);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 420; i += 1) {
        starPositions.push(
            (Math.random() - 0.5) * 18,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 18
        );
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
            color: 0x8ee8ff,
            size: 0.025,
            transparent: true,
            opacity: 0.48
        })
    );
    group.add(stars);

    const source = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 32, 16),
        new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x00f0ff,
            emissiveIntensity: 2.2
        })
    );
    source.position.set(0, 0, -4.2);
    group.add(source);

    const beamGeometry = new THREE.CylinderGeometry(0.04, 1.8, 5.6, 48, 1, true);
    const beam = new THREE.Mesh(
        beamGeometry,
        new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.z = -1.3;
    group.add(beam);

    const screenGeometry = new THREE.PlaneGeometry(6.8, 4.1, 84, 48);
    const screenBase = screenGeometry.attributes.position.array.slice();
    const screenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x00d8ff,
        emissive: 0x003b66,
        roughness: 0.28,
        metalness: 0,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.z = -0.35;
    group.add(screen);

    const screenWire = new THREE.LineSegments(
        new THREE.WireframeGeometry(screenGeometry),
        new THREE.LineBasicMaterial({
            color: 0x7af7ff,
            transparent: true,
            opacity: 0.2
        })
    );
    screen.add(screenWire);

    const observer = new THREE.Mesh(
        new THREE.RingGeometry(1.35, 1.42, 80),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.52,
            side: THREE.DoubleSide
        })
    );
    observer.position.z = 3.1;
    group.add(observer);

    const observerPlane = new THREE.GridHelper(4.8, 14, 0x00f0ff, 0x204763);
    observerPlane.rotation.x = Math.PI / 2;
    observerPlane.position.z = 3.1;
    observerPlane.material.transparent = true;
    observerPlane.material.opacity = 0.22;
    group.add(observerPlane);

    const wavefronts = [];
    for (let i = 0; i < 7; i += 1) {
        const wave = new THREE.Mesh(
            new THREE.TorusGeometry(0.86 + i * 0.18, 0.012, 10, 96),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0x90fbff : 0x00f0ff,
                transparent: true,
                opacity: 0.56,
                depthWrite: false
            })
        );
        wave.position.z = -3.8 + i * 0.95;
        wavefronts.push(wave);
        group.add(wave);
    }

    const plasmaMaterial = new THREE.LineBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.88
    });
    let plasmaLine = null;

    function state() {
        return {
            delay: Number(controls.delay?.value || 30),
            frequency: Number(controls.frequency?.value || 1400),
            bandwidth: Number(controls.bandwidth?.value || 400),
            plasma: Number(controls.plasma?.value || 35) / 100,
            zoom: Number(controls.zoom?.value || 100) / 100
        };
    }

    function rebuildPlasmaPath(plasmaStrength) {
        if (plasmaLine) {
            plasmaLine.geometry.dispose();
            group.remove(plasmaLine);
        }

        const points = [];
        for (let i = 0; i < 80; i += 1) {
            const t = i / 79;
            const z = -4 + t * 7.2;
            const x = Math.sin(t * Math.PI) * plasmaStrength * 0.95;
            const y = -0.72 + Math.pow(t, 1.7) * plasmaStrength * 1.05;
            points.push(new THREE.Vector3(x, y, z));
        }
        plasmaLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), plasmaMaterial);
        group.add(plasmaLine);
    }

    function deformScreen(time, current) {
        const positions = screenGeometry.attributes.position.array;
        const amplitude = current.delay / 120 * 0.62;
        const bandwidthScale = current.bandwidth / 900;
        for (let i = 0; i < positions.length; i += 3) {
            const x = screenBase[i];
            const y = screenBase[i + 1];
            positions[i] = x;
            positions[i + 1] = y;
            positions[i + 2] =
                Math.sin(x * 1.85 + time * 0.9) * Math.cos(y * 2.25 - time * 0.55) * amplitude +
                Math.sin((x + y) * 3.2 + time) * 0.08 * bandwidthScale;
        }
        screenGeometry.attributes.position.needsUpdate = true;
        screenGeometry.computeVertexNormals();
    }

    let previousPlasma = -1;

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width));
        const height = Math.max(320, Math.floor(rect.height));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }

    function animate(now) {
        const time = now * 0.001;
        const current = state();

        if (Math.abs(current.plasma - previousPlasma) > 0.01) {
            rebuildPlasmaPath(current.plasma);
            previousPlasma = current.plasma;
        }

        camera.position.z = 10.2 - Math.min(current.zoom, 2.2) * 2.4;
        camera.position.y = 1.45 + Math.sin(time * 0.22) * 0.18;
        camera.lookAt(0, 0, 0.1);

        source.scale.setScalar(1 + Math.sin(time * 5) * 0.1);
        group.rotation.y = Math.sin(time * 0.18) * 0.18;
        group.rotation.x = -0.09 + Math.sin(time * 0.13) * 0.04;

        deformScreen(time, current);

        const speed = 0.48 + current.frequency / 5000;
        wavefronts.forEach((wave, index) => {
            const offset = ((time * speed + index * 0.85) % 6.8) - 3.7;
            wave.position.z = offset;
            const spread = 1 + ((offset + 3.7) / 6.8) * 0.55 + current.delay / 360;
            wave.scale.set(spread, spread, 1);
            wave.material.opacity = 0.15 + (1 - Math.abs(offset - 0.15) / 4.2) * 0.5;
        });

        observer.rotation.z = time * 0.18;
        observerPlane.rotation.z = time * -0.06;
        stars.rotation.y = time * 0.015;

        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }

    Object.values(controls).forEach((control) => {
        control?.addEventListener('input', () => {
            const current = state();
            rebuildPlasmaPath(current.plasma);
            previousPlasma = current.plasma;
        });
    });

    window.addEventListener('resize', resize);
    resize();
    rebuildPlasmaPath(state().plasma);
    requestAnimationFrame(animate);
}

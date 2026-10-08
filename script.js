import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Configuration
const CONFIG = {
    particleCount: 15000,
    auraCount: 3500,
    bloomStrength: 1.85,
    bloomRadius: 0.65,
    bloomThreshold: 0.12,
    heartScale: 0.18,
    assembleDuration: 3.5, // seconds for initial gathering
};

// State Variables
let scene, camera, renderer, composer;
let heartParticles, auraParticles;
let heartGeometry, auraGeometry;
let heartMaterial, auraMaterial;

let clock = new THREE.Clock();
let mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;

// Heart Equation generator
// Parametric Heart 3D:
// x = 16 * sin(t)^3
// y = 13*cos(t) - 5*cos(2t) - 2*cos(3t) - cos(4t)
// with volumetric expansion and Z depth
function getHeartPosition(t, u, v) {
    const xBase = 16 * Math.pow(Math.sin(t), 3);
    const yBase = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    
    // Scale inward to fill volume (radial factor r: 0 -> 1)
    // using square root for even spatial density
    const r = Math.sqrt(u); 
    const x = xBase * r * CONFIG.heartScale;
    const y = yBase * r * CONFIG.heartScale;
    
    // Calculate realistic 3D thickness: thickness tapers off at top/bottom and edges
    const maxThickness = (1.0 - Math.pow(r, 1.8)) * 8.5 + 1.2;
    const z = (v - 0.5) * 2 * maxThickness * CONFIG.heartScale * (0.8 + 0.4 * Math.sin(t * 2));
    
    return { x, y, z };
}

// Generate smooth circular glow particle texture with soft falloff
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.15, 'rgba(255, 180, 220, 0.95)');
    gradient.addColorStop(0.45, 'rgba(255, 40, 110, 0.6)');
    gradient.addColorStop(0.75, 'rgba(220, 10, 80, 0.2)');
    gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    return texture;
}

function init() {
    const container = document.getElementById('webgl-container');

    // 1. Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.015);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 14);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. Post-processing (Unreal Bloom)
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        CONFIG.bloomStrength,
        CONFIG.bloomRadius,
        CONFIG.bloomThreshold
    );

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    // 5. Build Heart Particles System
    buildHeartParticles();

    // 6. Build Floating Aura/Ambient Particles System
    buildAuraParticles();

    // 7. Event Listeners
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('pointermove', onPointerMove, false);
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    // Animate
    animate();
}

function buildHeartParticles() {
    const count = CONFIG.particleCount;
    heartGeometry = new THREE.BufferGeometry();

    const currentPositions = new Float32Array(count * 3);
    const targetPositions = new Float32Array(count * 3);
    const originPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randomOffsets = new Float32Array(count * 3);

    // Palette: Vibrant neon pinks, deep ruby, passionate magentas, and pure white highlights
    const colorPalette = [
        new THREE.Color(0xff1493), // DeepPink
        new THREE.Color(0xff2d75), // Neon Red-Pink
        new THREE.Color(0xff0055), // Bright Crimson Magenta
        new THREE.Color(0xff69b4), // HotPink
        new THREE.Color(0xff3366), // Vivid Rose
        new THREE.Color(0xffffff), // Sparkle White
        new THREE.Color(0xff80bf), // Soft Pink
    ];

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Parametric coordinates
        const t = Math.random() * Math.PI * 2;
        const u = Math.random();
        const v = Math.random();

        const heartPos = getHeartPosition(t, u, v);
        targetPositions[i3] = heartPos.x;
        targetPositions[i3 + 1] = heartPos.y;
        targetPositions[i3 + 2] = heartPos.z;

        // Initial exploded / scattered positions (sphere burst shell)
        const radius = 25 + Math.random() * 45;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const ox = radius * Math.sin(phi) * Math.cos(theta);
        const oy = radius * Math.sin(phi) * Math.sin(theta);
        const oz = radius * Math.cos(phi);

        originPositions[i3] = ox;
        originPositions[i3 + 1] = oy;
        originPositions[i3 + 2] = oz;

        // Current start at origin positions
        currentPositions[i3] = ox;
        currentPositions[i3 + 1] = oy;
        currentPositions[i3 + 2] = oz;

        // Assign colors: 8% sparkling white, rest beautiful pink/red blends
        const isHighlight = Math.random() < 0.08;
        let c;
        if (isHighlight) {
            c = colorPalette[5]; // White sparkle
        } else {
            const pick = Math.floor(Math.random() * colorPalette.length);
            c = colorPalette[pick].clone();
            // Subtle brightness variations
            c.offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.1);
        }

        colors[i3] = c.r;
        colors[i3 + 1] = c.g;
        colors[i3 + 2] = c.b;

        // Size variations
        sizes[i] = isHighlight ? Math.random() * 0.22 + 0.18 : Math.random() * 0.16 + 0.08;

        // Random jitter offsets for organic life movement
        randomOffsets[i3] = (Math.random() - 0.5) * 2;
        randomOffsets[i3 + 1] = (Math.random() - 0.5) * 2;
        randomOffsets[i3 + 2] = (Math.random() - 0.5) * 2;
    }

    heartGeometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
    heartGeometry.setAttribute('targetPosition', new THREE.BufferAttribute(targetPositions, 3));
    heartGeometry.setAttribute('originPosition', new THREE.BufferAttribute(originPositions, 3));
    heartGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    heartGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    heartGeometry.setAttribute('randomOffset', new THREE.BufferAttribute(randomOffsets, 3));

    // Particle Material
    heartMaterial = new THREE.PointsMaterial({
        size: 0.18,
        vertexColors: true,
        map: createGlowTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        sizeAttenuation: true
    });

    heartParticles = new THREE.Points(heartGeometry, heartMaterial);
    scene.add(heartParticles);
}

function buildAuraParticles() {
    const count = CONFIG.auraCount;
    auraGeometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const speeds = new Float32Array(count * 3);
    const life = new Float32Array(count);

    const auraColor = new THREE.Color(0xff2d75);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Start near heart edge and float outward
        const t = Math.random() * Math.PI * 2;
        const u = 0.85 + Math.random() * 0.35;
        const v = Math.random();
        const base = getHeartPosition(t, u, v);

        positions[i3] = base.x * 1.05;
        positions[i3 + 1] = base.y * 1.05;
        positions[i3 + 2] = base.z * 1.05;

        // Float direction (drift outwards with subtle upward draft)
        const angle = Math.atan2(base.y, base.x);
        speeds[i3] = Math.cos(angle) * (0.2 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.2;
        speeds[i3 + 1] = Math.sin(angle) * (0.2 + Math.random() * 0.5) + 0.3 + Math.random() * 0.4;
        speeds[i3 + 2] = (Math.random() - 0.5) * 0.8;

        life[i] = Math.random(); // 0 to 1 life progression

        colors[i3] = auraColor.r;
        colors[i3 + 1] = auraColor.g * (0.7 + Math.random() * 0.3);
        colors[i3 + 2] = auraColor.b;
    }

    auraGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    auraGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    auraGeometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 3));
    auraGeometry.setAttribute('life', new THREE.BufferAttribute(life, 1));

    auraMaterial = new THREE.PointsMaterial({
        size: 0.12,
        vertexColors: true,
        map: createGlowTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        sizeAttenuation: true
    });

    auraParticles = new THREE.Points(auraGeometry, auraMaterial);
    scene.add(auraParticles);
}

// Cubic ease-out
function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
}

// Heartbeat formula simulating lub-dub physiological pulse
function getHeartbeatScale(time) {
    // 68-72 BPM rhythm: period roughly 1.1s
    const period = 1.1;
    const t = (time % period) / period; // normalized 0 -> 1

    let beat = 0;
    // Primary Beat (Lub) - punchy rise and fall
    if (t < 0.18) {
        beat = Math.sin((t / 0.18) * Math.PI) * 0.11;
    } 
    // Secondary Beat (Dub) - softer echo
    else if (t >= 0.22 && t < 0.42) {
        beat = Math.sin(((t - 0.22) / 0.20) * Math.PI) * 0.055;
    }

    return 1.0 + beat;
}

function onWindowResize() {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerMove(e) {
    mouse.targetX = (e.clientX - windowHalfX) * 0.0018;
    mouse.targetY = (e.clientY - windowHalfY) * 0.0018;
}

function onTouchMove(e) {
    if (e.touches.length > 0) {
        mouse.targetX = (e.touches[0].clientX - windowHalfX) * 0.0018;
        mouse.targetY = (e.touches[0].clientY - windowHalfY) * 0.0018;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();
    const delta = clock.getDelta();

    // 1. Mouse smooth parallax damping
    mouse.x += (mouse.targetX - mouse.x) * 0.045;
    mouse.y += (mouse.targetY - mouse.y) * 0.045;

    // Camera gentle 3D orbit and hover
    camera.position.x = Math.sin(elapsedTime * 0.25) * 0.8 + mouse.x * 4.5;
    camera.position.y = Math.cos(elapsedTime * 0.2) * 0.5 - mouse.y * 4.5;
    camera.position.z = 14 + Math.sin(elapsedTime * 0.3) * 0.3;
    camera.lookAt(0, 0, 0);

    // 2. Assembly progress (0 -> 1 over CONFIG.assembleDuration)
    const rawProgress = Math.min(elapsedTime / CONFIG.assembleDuration, 1.0);
    const progress = easeOutCubic(rawProgress);

    // 3. Heartbeat scale factor
    const beatScale = rawProgress >= 0.8 ? getHeartbeatScale(elapsedTime) : 1.0;

    // 4. Update Heart Particles
    if (heartGeometry) {
        const positions = heartGeometry.attributes.position.array;
        const targets = heartGeometry.attributes.targetPosition.array;
        const origins = heartGeometry.attributes.originPosition.array;
        const offsets = heartGeometry.attributes.randomOffset.array;
        const count = CONFIG.particleCount;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Target coordinate modulated by heartbeat scale
            const tx = targets[i3] * beatScale;
            const ty = targets[i3 + 1] * beatScale;
            const tz = targets[i3 + 2] * beatScale;

            // Organic breathing / slight shimmer wiggle
            const shimmer = 0.04 * Math.sin(elapsedTime * 3.5 + i);
            const ox = origins[i3];
            const oy = origins[i3 + 1];
            const oz = origins[i3 + 2];

            // Interpolation from origin to target
            const curX = ox + (tx - ox) * progress;
            const curY = oy + (ty - oy) * progress;
            const curZ = oz + (tz - oz) * progress;

            // Add alive micro-movement once assembled
            if (rawProgress >= 0.75) {
                positions[i3] = curX + offsets[i3] * shimmer;
                positions[i3 + 1] = curY + offsets[i3 + 1] * shimmer;
                positions[i3 + 2] = curZ + offsets[i3 + 2] * shimmer;
            } else {
                positions[i3] = curX;
                positions[i3 + 1] = curY;
                positions[i3 + 2] = curZ;
            }
        }
        heartGeometry.attributes.position.needsUpdate = true;

        // Subtle slow rotation of the heart mesh
        heartParticles.rotation.y = Math.sin(elapsedTime * 0.4) * 0.12;
        heartParticles.rotation.x = Math.cos(elapsedTime * 0.3) * 0.06;
    }

    // 5. Update Floating Aura Particles
    if (auraGeometry) {
        const positions = auraGeometry.attributes.position.array;
        const speeds = auraGeometry.attributes.speed.array;
        const life = auraGeometry.attributes.life.array;
        const count = CONFIG.auraCount;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            // Life cycle
            life[i] += 0.007;
            if (life[i] > 1.0) {
                life[i] = 0.0;
                // Respawn on heart surface
                const t = Math.random() * Math.PI * 2;
                const u = 0.82 + Math.random() * 0.3;
                const v = Math.random();
                const base = getHeartPosition(t, u, v);
                positions[i3] = base.x * beatScale;
                positions[i3 + 1] = base.y * beatScale;
                positions[i3 + 2] = base.z * beatScale;
            } else {
                // Float outwards
                positions[i3] += speeds[i3] * 0.025;
                positions[i3 + 1] += speeds[i3 + 1] * 0.028;
                positions[i3 + 2] += speeds[i3 + 2] * 0.025;
            }
        }
        auraGeometry.attributes.position.needsUpdate = true;

        // Match aura rotation
        auraParticles.rotation.y = heartParticles.rotation.y;
        auraParticles.rotation.x = heartParticles.rotation.x;
    }

    // 6. Render with Bloom Composer
    composer.render();
}

// Start
window.addEventListener('DOMContentLoaded', init);

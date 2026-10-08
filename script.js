import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                 ('ontouchstart' in window) || 
                 (window.innerWidth < 768);

// Configuration
const CONFIG = {
    particleCount: isMobile ? 12000 : 15000,
    auraCount: isMobile ? 2600 : 3500,
    bloomStrength: isMobile ? 1.55 : 1.85,
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
let assembleStartTime = 0;
let shockwaveTime = -10;

// Interactive 3D Orbit & Touch Variables
let isTouching = false;
let touchStartX = 0;
let touchStartY = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let touchDragDistance = 0;
let orbitRotX = 0;
let orbitRotY = 0;
let orbitVelX = 0;
let orbitVelY = 0;

// Heart Equation generator
// Parametric Heart 3D:
// x = 16 * sin(t)^3
// y = 13*cos(t) - 5*cos(2t) - 2*cos(3t) - cos(4t)
// with volumetric expansion and Z depth
function getHeartPosition(t, u, v) {
    const xBase = 16 * Math.pow(Math.sin(t), 3);
    const yBase = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    
    // Scale inward to fill volume (radial factor r: 0 -> 1)
    const r = Math.sqrt(u); 
    const x = xBase * r * CONFIG.heartScale;
    const y = yBase * r * CONFIG.heartScale;
    
    // Calculate realistic 3D thickness
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

// Dynamically compute camera distance so heart is never cropped on narrow mobile screens
function getCameraBaseZ() {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect < 1.0) {
        // Mobile portrait: scale distance so heart and aura fit with ample margins
        return Math.max(16.5, 9.2 / aspect);
    }
    return 14.0;
}

function updateCameraPosition() {
    camera.position.set(0, 0, getCameraBaseZ());
}

function init() {
    const container = document.getElementById('webgl-container');

    // 1. Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.015);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    updateCameraPosition();

    // 3. Renderer - optimized pixel ratio for mobile performance
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.6 : 2.0));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. Post-processing (Unreal Bloom)
    try {
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
    } catch (e) {
        console.warn('Post-processing composer disabled on this device, using fallback renderer', e);
        composer = null;
    }

    // 5. Build Heart Particles System
    buildHeartParticles();

    // 6. Build Floating Aura/Ambient Particles System (Both Inward and Outward flow)
    buildAuraParticles();

    // 7. Event Listeners (Pointer, Touch, and Gyroscope)
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('pointermove', onPointerMove, false);
    window.addEventListener('pointerdown', onTriggerPulse, false);

    // Touch events for drag rotation and tap
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    // Gyroscope subtle tilt for mobile
    if (window.DeviceOrientationEvent && isMobile) {
        window.addEventListener('deviceorientation', onDeviceOrientation, false);
    }

    // UI hint text dynamic update
    const subHint = document.querySelector('.sub-hint');
    if (subHint) {
        if (isMobile) {
            subHint.textContent = 'Drag to rotate • Tap to feel beat';
        } else {
            subHint.textContent = 'Move cursor to interact • Click to pulse';
        }
    }

    const titleEl = document.querySelector('.title');
    if (titleEl) {
        titleEl.style.cursor = 'pointer';
        titleEl.style.pointerEvents = 'auto';
        titleEl.addEventListener('click', restartAssembly);
    }

    // Animate
    clock.start();
    assembleStartTime = clock.getElapsedTime();
    animate();
}

function restartAssembly() {
    assembleStartTime = clock.getElapsedTime();
}

function onTriggerPulse() {
    shockwaveTime = clock.getElapsedTime();
}

function onTouchStart(e) {
    if (e.touches.length > 0) {
        isTouching = true;
        touchDragDistance = 0;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        lastTouchX = touchStartX;
        lastTouchY = touchStartY;
    }
}

function onTouchMove(e) {
    if (e.touches.length > 0) {
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        const deltaX = clientX - lastTouchX;
        const deltaY = clientY - lastTouchY;
        touchDragDistance += Math.hypot(deltaX, deltaY);

        orbitVelY += deltaX * 0.0035;
        orbitVelX += deltaY * 0.0035;

        lastTouchX = clientX;
        lastTouchY = clientY;

        mouse.targetX = (clientX - windowHalfX) * 0.002;
        mouse.targetY = (clientY - windowHalfY) * 0.002;
    }
}

function onTouchEnd() {
    isTouching = false;
    // If it was a tap without significant dragging, trigger heartbeat shockwave
    if (touchDragDistance < 10) {
        onTriggerPulse();
    }
}

function onDeviceOrientation(e) {
    if (e.gamma !== null && e.beta !== null && !isTouching) {
        const gx = Math.min(Math.max(e.gamma / 30, -1), 1);
        const gy = Math.min(Math.max((e.beta - 45) / 30, -1), 1);
        mouse.targetX = gx * 0.6;
        mouse.targetY = gy * 0.6;
    }
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

    // Palette: Vibrant neon pinks, deep ruby, passionate magentas, and sparkle white highlights
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

        currentPositions[i3] = ox;
        currentPositions[i3 + 1] = oy;
        currentPositions[i3 + 2] = oz;

        // Assign colors: ~8% sparkling white, rest beautiful pink/red blends
        const isHighlight = Math.random() < 0.08;
        let c;
        if (isHighlight) {
            c = colorPalette[5]; // White sparkle
        } else {
            const pick = Math.floor(Math.random() * colorPalette.length);
            c = colorPalette[pick].clone();
            c.offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.1);
        }

        colors[i3] = c.r;
        colors[i3 + 1] = c.g;
        colors[i3 + 2] = c.b;

        sizes[i] = isHighlight ? Math.random() * 0.22 + 0.18 : Math.random() * 0.16 + 0.08;

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

    heartMaterial = new THREE.PointsMaterial({
        size: isMobile ? 0.22 : 0.17,
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
    const modes = new Float32Array(count); // 0 = drift outward, 1 = drift inward

    const auraColor = new THREE.Color(0xff2d75);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // 60% drift outward, 40% drift inward towards heart
        const isDriftingIn = Math.random() < 0.4;
        modes[i] = isDriftingIn ? 1.0 : 0.0;

        const t = Math.random() * Math.PI * 2;
        const u = isDriftingIn ? (1.3 + Math.random() * 1.2) : (0.85 + Math.random() * 0.35);
        const v = Math.random();
        const base = getHeartPosition(t, u, v);

        positions[i3] = base.x * 1.05;
        positions[i3 + 1] = base.y * 1.05;
        positions[i3 + 2] = base.z * 1.05;

        const angle = Math.atan2(base.y, base.x);
        const dir = isDriftingIn ? -1.0 : 1.0;

        speeds[i3] = dir * (Math.cos(angle) * (0.2 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.2);
        speeds[i3 + 1] = dir * (Math.sin(angle) * (0.2 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.2);
        speeds[i3 + 2] = (Math.random() - 0.5) * 0.7;

        life[i] = Math.random();

        colors[i3] = auraColor.r;
        colors[i3 + 1] = auraColor.g * (0.7 + Math.random() * 0.3);
        colors[i3 + 2] = auraColor.b;
    }

    auraGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    auraGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    auraGeometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 3));
    auraGeometry.setAttribute('life', new THREE.BufferAttribute(life, 1));
    auraGeometry.setAttribute('mode', new THREE.BufferAttribute(modes, 1));

    auraMaterial = new THREE.PointsMaterial({
        size: isMobile ? 0.15 : 0.12,
        vertexColors: true,
        map: createGlowTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.70,
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
    const period = 1.15;
    const t = (time % period) / period;

    let beat = 0;
    // Primary Beat (Lub) - punchy expansion 1.05 - 1.12x
    if (t < 0.16) {
        beat = Math.sin((t / 0.16) * Math.PI) * 0.10;
    } 
    // Secondary Beat (Dub) - softer echo
    else if (t >= 0.20 && t < 0.38) {
        beat = Math.sin(((t - 0.20) / 0.18) * Math.PI) * 0.05;
    }

    return 1.0 + beat;
}

function onWindowResize() {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateCameraPosition();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

function onPointerMove(e) {
    if (!isTouching) {
        mouse.targetX = (e.clientX - windowHalfX) * 0.0018;
        mouse.targetY = (e.clientY - windowHalfY) * 0.0018;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const currentTime = clock.getElapsedTime();
    const elapsedTimeSinceAssemble = currentTime - assembleStartTime;

    // 1. Mouse smooth parallax damping
    mouse.x += (mouse.targetX - mouse.x) * 0.045;
    mouse.y += (mouse.targetY - mouse.y) * 0.045;

    // Smooth touch orbit damping & momentum
    orbitRotY += orbitVelY;
    orbitRotX += orbitVelX;
    orbitVelY *= 0.92;
    orbitVelX *= 0.92;
    orbitRotX = Math.max(-0.6, Math.min(0.6, orbitRotX));

    // Dynamic responsive camera distance for mobile portrait & landscape
    const baseZ = getCameraBaseZ();
    camera.position.x = Math.sin(currentTime * 0.25) * 0.8 + mouse.x * 4.5;
    camera.position.y = Math.cos(currentTime * 0.2) * 0.5 - mouse.y * 4.5;
    camera.position.z = baseZ + Math.sin(currentTime * 0.3) * 0.3;
    camera.lookAt(0, 0, 0);

    // 2. Assembly progress (0 -> 1 over CONFIG.assembleDuration)
    const rawProgress = Math.min(elapsedTimeSinceAssemble / CONFIG.assembleDuration, 1.0);
    const progress = easeOutCubic(rawProgress);

    // 3. Heartbeat scale factor
    let beatScale = rawProgress >= 0.8 ? getHeartbeatScale(currentTime) : 1.0;

    // Optional touch shockwave effect
    const timeSinceShockwave = currentTime - shockwaveTime;
    if (timeSinceShockwave >= 0 && timeSinceShockwave < 0.6) {
        const shockProgress = timeSinceShockwave / 0.6;
        beatScale += Math.sin(shockProgress * Math.PI) * 0.22;
    }

    // Dynamic particle size pulse in sync with heartbeat
    if (heartMaterial) {
        const baseSize = isMobile ? 0.22 : 0.17;
        heartMaterial.size = baseSize * beatScale;
    }

    // 4. Update Heart Particles
    if (heartGeometry) {
        const positions = heartGeometry.attributes.position.array;
        const targets = heartGeometry.attributes.targetPosition.array;
        const origins = heartGeometry.attributes.originPosition.array;
        const offsets = heartGeometry.attributes.randomOffset.array;
        const count = CONFIG.particleCount;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            const tx = targets[i3] * beatScale;
            const ty = targets[i3 + 1] * beatScale;
            const tz = targets[i3 + 2] * beatScale;

            const shimmer = 0.04 * Math.sin(currentTime * 3.5 + i);
            const ox = origins[i3];
            const oy = origins[i3 + 1];
            const oz = origins[i3 + 2];

            const curX = ox + (tx - ox) * progress;
            const curY = oy + (ty - oy) * progress;
            const curZ = oz + (tz - oz) * progress;

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

        heartParticles.rotation.y = Math.sin(currentTime * 0.4) * 0.12 + orbitRotY;
        heartParticles.rotation.x = Math.cos(currentTime * 0.3) * 0.06 + orbitRotX;
    }

    // 5. Update Floating Aura Particles (Both Inward and Outward flow)
    if (auraGeometry) {
        const positions = auraGeometry.attributes.position.array;
        const speeds = auraGeometry.attributes.speed.array;
        const life = auraGeometry.attributes.life.array;
        const modes = auraGeometry.attributes.mode.array;
        const count = CONFIG.auraCount;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;

            life[i] += 0.007;
            if (life[i] > 1.0) {
                life[i] = 0.0;
                const isDriftingIn = modes[i] === 1.0;
                const t = Math.random() * Math.PI * 2;
                const u = isDriftingIn ? (1.3 + Math.random() * 1.2) : (0.82 + Math.random() * 0.3);
                const v = Math.random();
                const base = getHeartPosition(t, u, v);
                positions[i3] = base.x * beatScale;
                positions[i3 + 1] = base.y * beatScale;
                positions[i3 + 2] = base.z * beatScale;
            } else {
                positions[i3] += speeds[i3] * 0.025;
                positions[i3 + 1] += speeds[i3 + 1] * 0.028;
                positions[i3 + 2] += speeds[i3 + 2] * 0.025;
            }
        }
        auraGeometry.attributes.position.needsUpdate = true;

        if (heartParticles) {
            auraParticles.rotation.y = heartParticles.rotation.y;
            auraParticles.rotation.x = heartParticles.rotation.x;
        }
    }

    // 6. Render with Composer or Fallback Renderer
    if (composer) {
        try {
            composer.render();
        } catch (err) {
            renderer.render(scene, camera);
        }
    } else {
        renderer.render(scene, camera);
    }
}

// Start
window.addEventListener('DOMContentLoaded', init);

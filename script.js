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
// with perfectly symmetrical 3D volumetric thickness
function getHeartPosition(t, u, v) {
    const xBase = 16 * Math.pow(Math.sin(t), 3);
    const yBase = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    
    // Scale inward to fill volume (radial factor r: 0 -> 1)
    const r = Math.sqrt(u); 
    const x = xBase * r * CONFIG.heartScale;
    const y = yBase * r * CONFIG.heartScale;
    
    // Symmetrical 3D thickness (pure, balanced depth across both lobes)
    const maxThickness = (1.0 - Math.pow(r, 1.8)) * 8.5 + 1.2;
    const z = (v - 0.5) * 2 * maxThickness * CONFIG.heartScale;
    
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

    // Initialize Gate Modal and Runaway Button
    initGateAndRunaway();

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

// Balloon photos array (all 5 distinct memories)
const BALLOON_IMAGES = [
    'images/card1.png',
    'images/card2.jpg',
    'images/card3.jpg',
    'images/card4.png',
    'images/card5.png'
];

const REJECT_TEASES = [
    'ไม่รับ 😜',
    'เอ๊ะ กดไม่ทัน 🏃‍♂️💨',
    'แน่ะ จะไม่รับจริงหยอ 🥺',
    'ไม่ให้กดดด 😝',
    'ยอมรับเถอะน้าา 💕',
    'กดปุ่มรับดีกว่าาา 👉💖',
    'หนีอีกแล้วว 💨',
    'อย่าน้าา รับเถอะ 🥺'
];

let rejectTeaseIndex = 0;
let isGateOpen = true;
let balloonTimer = null;
let photoQueue = [];
let lastZoneIndex = 0;

// Distinct photo cycle queue - guarantees all 5 photos appear without repeats
function getNextPhoto() {
    if (photoQueue.length === 0) {
        photoQueue = [...BALLOON_IMAGES].sort(() => Math.random() - 0.5);
    }
    return photoQueue.pop();
}

function initGateAndRunaway() {
    const gateOverlay = document.getElementById('gate-overlay');
    const btnAccept = document.getElementById('btn-accept');
    const btnReject = document.getElementById('btn-reject');
    const rejectText = document.getElementById('reject-text');

    if (!btnReject || !btnAccept || !gateOverlay) return;

    function runawayButton(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Attach directly to body so position: fixed is genuinely relative to viewport
        if (btnReject.parentNode !== document.body) {
            document.body.appendChild(btnReject);
        }

        // Advance playful tease text
        rejectTeaseIndex = (rejectTeaseIndex + 1) % REJECT_TEASES.length;
        if (rejectText) {
            rejectText.textContent = REJECT_TEASES[rejectTeaseIndex];
        }

        btnReject.style.position = 'fixed';
        btnReject.style.zIndex = '99999';

        // Accurately measure button and safe screen bounds
        const btnW = btnReject.offsetWidth || 135;
        const btnH = btnReject.offsetHeight || 44;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        const padX = 20;
        const padY = 55; // safe for status bar / navigation bar
        const minX = padX;
        const maxX = Math.max(minX, screenW - btnW - padX);
        const minY = padY;
        const maxY = Math.max(minY, screenH - btnH - padY);

        let touchX = screenW / 2;
        let touchY = screenH / 2;
        if (e) {
            if (e.clientX !== undefined) {
                touchX = e.clientX;
                touchY = e.clientY;
            } else if (e.touches && e.touches[0]) {
                touchX = e.touches[0].clientX;
                touchY = e.touches[0].clientY;
            }
        }

        // Calculate target location far from finger (opposite side)
        let targetX;
        if (touchX < screenW / 2) {
            targetX = (screenW * 0.52) + Math.random() * Math.max(10, maxX - (screenW * 0.52));
        } else {
            targetX = minX + Math.random() * Math.max(10, (screenW * 0.45) - btnW - minX);
        }

        let targetY;
        if (touchY < screenH / 2) {
            targetY = (screenH * 0.52) + Math.random() * Math.max(10, maxY - (screenH * 0.52));
        } else {
            targetY = minY + Math.random() * Math.max(10, (screenH * 0.45) - btnH - minY);
        }

        // Strict clamp inside screen
        targetX = Math.max(minX, Math.min(maxX, targetX));
        targetY = Math.max(minY, Math.min(maxY, targetY));

        btnReject.style.left = `${Math.round(targetX)}px`;
        btnReject.style.top = `${Math.round(targetY)}px`;
    }

    // Run away on hover, touch, pointer
    btnReject.addEventListener('mouseenter', runawayButton);
    btnReject.addEventListener('touchstart', runawayButton, { passive: false });
    btnReject.addEventListener('pointerdown', runawayButton);

    // Accept button logic
    btnAccept.addEventListener('click', () => {
        isGateOpen = false;
        createAcceptBurst(btnAccept);
        gateOverlay.classList.add('hidden');
        if (btnReject && btnReject.parentElement) {
            btnReject.remove(); // Remove runaway button completely
        }
        restartAssembly();
        startHeartBalloons();
    });
}

function createAcceptBurst(el) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const emojis = ['💖', '✨', '💕', '🌸', '💝', '🎉'];

    for (let i = 0; i < 22; i++) {
        const particle = document.createElement('div');
        particle.className = 'balloon-burst-particle';
        particle.textContent = emojis[Math.floor(Math.random() * emojis.length)];

        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 130;
        const tx = `${Math.cos(angle) * dist}px`;
        const ty = `${Math.sin(angle) * dist}px`;
        const rot = `${(Math.random() - 0.5) * 360}deg`;
        const duration = `${0.6 + Math.random() * 0.5}s`;

        particle.style.left = `${centerX}px`;
        particle.style.top = `${centerY}px`;
        particle.style.setProperty('--tx', tx);
        particle.style.setProperty('--ty', ty);
        particle.style.setProperty('--rot', rot);
        particle.style.setProperty('--duration', duration);

        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 1200);
    }
}

// Release strictly ONE balloon at a time in peaceful rotation
function spawnSingleBalloon() {
    const container = document.getElementById('balloons-container');
    if (!container || isGateOpen) return;

    const imgSrc = getNextPhoto();

    // Alternate lanes: Left side (10-28%), Right side (72-90%), Center-offset (38-62%)
    // Keep mostly around the sides so the center 3D heart is clearly visible
    const zones = [
        { min: 10, max: 26 },
        { min: 74, max: 90 },
        { min: 28, max: 42 },
        { min: 58, max: 72 }
    ];
    lastZoneIndex = (lastZoneIndex + 1) % zones.length;
    const zone = zones[lastZoneIndex];
    const leftPercent = zone.min + Math.random() * (zone.max - zone.min);

    spawnSingleHeartBalloon(imgSrc, leftPercent);
}

function spawnSingleHeartBalloon(imgSrc, leftPercent) {
    const container = document.getElementById('balloons-container');
    if (!container || isGateOpen) return;

    const balloon = document.createElement('div');
    balloon.className = 'heart-balloon';

    // Lively, smooth float speed: 5.6s - 7.0s
    const duration = isMobile 
        ? (5.6 + Math.random() * 1.4) 
        : (6.0 + Math.random() * 1.5);
    const swayDuration = 2.2 + Math.random() * 1.0;
    const swayDist = 12 + Math.random() * 12;
    const rotEnd = (Math.random() - 0.5) * 22;
    const size = isMobile ? (74 + Math.random() * 8) : (90 + Math.random() * 10);

    balloon.style.left = `${leftPercent}%`;
    balloon.style.setProperty('--balloon-size', `${size}px`);
    balloon.style.setProperty('--float-duration', `${duration}s`);
    balloon.style.setProperty('--sway-duration', `${swayDuration}s`);
    balloon.style.setProperty('--sway-dist', `${swayDist}px`);
    balloon.style.setProperty('--rot-end', `${rotEnd}deg`);

    balloon.innerHTML = `
        <div class="balloon-inner">
            <div class="balloon-frame">
                <img class="balloon-img" src="${imgSrc}" alt="balloon memory" loading="lazy">
                <div class="balloon-gloss"></div>
            </div>
            <div class="balloon-knot"></div>
            <div class="balloon-string"></div>
        </div>
    `;

    balloon.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        popBalloon(balloon, e.clientX || (balloon.getBoundingClientRect().left + size / 2),
                           e.clientY || (balloon.getBoundingClientRect().top + size / 2));
    });

    container.appendChild(balloon);

    setTimeout(() => {
        if (balloon && balloon.parentElement) {
            balloon.remove();
        }
    }, duration * 1000 + 400);
}

function popBalloon(balloon, clickX, clickY) {
    if (!balloon || !balloon.parentElement) return;

    createAcceptBurst({
        getBoundingClientRect: () => ({ left: clickX - 20, top: clickY - 20, width: 40, height: 40 })
    });

    onTriggerPulse();

    balloon.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
    balloon.style.transform = 'scale(1.35)';
    balloon.style.opacity = '0';
    setTimeout(() => {
        if (balloon && balloon.parentElement) balloon.remove();
    }, 180);
}

function startHeartBalloons() {
    if (balloonTimer) clearTimeout(balloonTimer);

    // Initial release: exactly ONE balloon to start
    spawnSingleBalloon();

    // Release strictly ONE balloon every 3.0 - 3.8 seconds
    function loop() {
        if (!isGateOpen) {
            spawnSingleBalloon();
        }
        const delay = 3000 + Math.random() * 800;
        balloonTimer = setTimeout(loop, delay);
    }
    balloonTimer = setTimeout(loop, 3000);
}

function restartAssembly() {
    assembleStartTime = clock.getElapsedTime();
    orbitRotX = 0;
    orbitRotY = 0;
    orbitVelX = 0;
    orbitVelY = 0;
    mouse.x = 0;
    mouse.y = 0;
    mouse.targetX = 0;
    mouse.targetY = 0;
    if (heartParticles) {
        heartParticles.rotation.set(0, 0, 0);
    }
    if (auraParticles) {
        auraParticles.rotation.set(0, 0, 0);
    }
    camera.position.set(0, 0, getCameraBaseZ());
    camera.lookAt(0, 0, 0);
}

function onTriggerPulse() {
    if (isGateOpen) return;
    shockwaveTime = clock.getElapsedTime();
}

function onTouchStart(e) {
    if (isGateOpen) return;
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
    if (isGateOpen) return;
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
    if (isGateOpen) return;
    isTouching = false;
    if (touchDragDistance < 10) {
        onTriggerPulse();
    }
}

function onDeviceOrientation(e) {
    if (isGateOpen) return;
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
    if (isGateOpen) return;
    if (!isTouching) {
        mouse.targetX = (e.clientX - windowHalfX) * 0.0018;
        mouse.targetY = (e.clientY - windowHalfY) * 0.0018;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const currentTime = clock.getElapsedTime();
    const elapsedTimeSinceAssemble = currentTime - assembleStartTime;
    const activeTime = Math.max(0, elapsedTimeSinceAssemble);

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
    const camHoverX = isGateOpen ? 0 : Math.sin(activeTime * 0.25) * 0.35;
    const camHoverY = isGateOpen ? 0 : Math.sin(activeTime * 0.2) * 0.25;
    camera.position.x = camHoverX + mouse.x * 3.5;
    camera.position.y = camHoverY - mouse.y * 3.5;
    camera.position.z = baseZ + (isGateOpen ? 0 : Math.sin(activeTime * 0.3) * 0.3);
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
        const idleRotY = isGateOpen ? 0 : Math.sin(activeTime * 0.35) * 0.07;
        const idleRotX = isGateOpen ? 0 : Math.sin(activeTime * 0.25) * 0.03;
        heartParticles.rotation.y = idleRotY + orbitRotY;
        heartParticles.rotation.x = idleRotX + orbitRotX;
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

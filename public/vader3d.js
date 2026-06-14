import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SIZE = 160;
const canvas = document.getElementById('vaderCanvas');
if (!canvas) throw new Error('vaderCanvas not found');

// Renderer con fondo transparente
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
camera.position.set(0, 0, 3.0);
camera.lookAt(0, -0.25, 0); // apunta un poco abajo → Vader sube en cuadro

// Iluminación
// Luz ambiente — apenas perceptible, Vader vive en las sombras
const ambient = new THREE.AmbientLight(0x223355, 1.8);
scene.add(ambient);

// Luz frontal suave — da forma sin revelar demasiado
const mainLight = new THREE.PointLight(0x4488ff, 6, 10);
mainLight.position.set(0.4, 0.8, 2.5);
scene.add(mainLight);

// SPOT LATERAL — ilumina parte de la máscara como foco de teatro
// Posición: derecha, ligeramente arriba, ligeramente al frente
// Color: blanco frío con pizca de azul — no tan directo como para blanquear
const sideSpot = new THREE.PointLight(0xaabbdd, 80, 10);
sideSpot.position.set(2.0, 0.5, 2.0);

// Foco arriba-centro
const topFill = new THREE.PointLight(0x889aaa, 38, 7);
topFill.position.set(0, 2.5, 1.5);
scene.add(topFill);

// Eye light — frontal directo a nivel de ojos, da profundidad a los lentes
const eyeLight = new THREE.PointLight(0xaaccee, 30, 4);
eyeLight.position.set(0, 0.15, 2.8); // casi frente a la máscara, altura de ojos
scene.add(eyeLight);
scene.add(sideSpot);

// RIM LIGHTS — definen el contorno de la máscara desde atrás
const rimTop = new THREE.PointLight(0x6699ff, 12, 6);
rimTop.position.set(0, 1.5, -1.5);   // arriba-atrás
scene.add(rimTop);

const rimLeft = new THREE.PointLight(0x4477dd, 10, 5);
rimLeft.position.set(-1.8, 0.2, -1); // izquierda-atrás
scene.add(rimLeft);

const rimRight = new THREE.PointLight(0x4477dd, 10, 5);
rimRight.position.set(1.8, 0.2, -1); // derecha-atrás
scene.add(rimRight);

// Colores por estado
const STATES = {
  idle:       { color: 0x4466cc, intensity: 7,  rim: 0x5588ff, rimInt: 50 },
  listening:  { color: 0x00bbff, intensity: 10, rim: 0x00ddff, rimInt: 42 },
  speaking:   { color: 0x00ff88, intensity: 10, rim: 0x00ff99, rimInt: 46 },
  processing: { color: 0x0066ff, intensity: 8,  rim: 0x4488ff, rimInt: 36 }
};

let currentState = 'idle';
const targetColor = new THREE.Color(STATES.idle.color);
let targetIntensity = STATES.idle.intensity;
const targetRimColor = new THREE.Color(STATES.idle.rim);
let targetRimInt = STATES.idle.rimInt;

// Mouse tracking
let targetRotX = 0, targetRotY = 0;
let currentRotX = 0, currentRotY = 0;

document.addEventListener('mousemove', (e) => {
  const nx = (e.clientX / window.innerWidth  - 0.5) * 2;
  const ny = (e.clientY / window.innerHeight - 0.5) * 2;
  targetRotY =  nx * 0.45;   // ±26° horizontal
  targetRotX =  ny * 0.22;   // ±13° vertical — sin negativo, cursor arriba = mira arriba
});

// Modelo — pivot separa orientación base del mouse tracking
let pivot = null;
const loader = new GLTFLoader();

loader.load(
  '/public/images/vader.glb',
  (gltf) => {
    const mesh = gltf.scene;

    // Centrar y escalar automáticamente
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    mesh.position.sub(center);
    mesh.scale.setScalar(1.45 / maxDim);

    // Modelo ya orientado correctamente en el GLB — sin rotación base necesaria

    // Ajustar materiales para que reaccionen mejor a la luz
    mesh.traverse(obj => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          m.roughness = 0.55;
          m.metalness = 0.45;
          m.needsUpdate = true;
        });
      }
    });

    pivot = new THREE.Group();
    pivot.add(mesh);
    scene.add(pivot);

    // Activar: oculta los anillos CSS, muestra el canvas
    const reactor = document.getElementById('reactor');
    if (reactor) reactor.classList.add('has-avatar');
  },
  undefined,
  (err) => console.warn('[vader3d] no se pudo cargar el modelo:', err)
);

// API de estado — app.js llama window.setVaderState('speaking') etc.
window.setVaderState = (mode) => {
  currentState = mode;
  const s = STATES[mode] || STATES.idle;
  targetColor.set(s.color);
  targetIntensity = s.intensity;
  targetRimColor.set(s.rim);
  targetRimInt = s.rimInt;
};

// Loop
const clock = new THREE.Clock();
const LERP = 0.09;

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Suavizado del mouse
  currentRotX += (targetRotX - currentRotX) * LERP;
  currentRotY += (targetRotY - currentRotY) * LERP;

  if (pivot) {
    // Movimiento autónomo según estado
    let autoX = 0, autoY = 0;

    if (currentState === 'speaking') {
      // Ondas apiladas → gesticula de forma natural, no mecánica
      autoX = Math.sin(t * 1.4)       * 0.10
            + Math.sin(t * 2.3 + 0.8) * 0.05
            + Math.sin(t * 3.7 + 1.5) * 0.025;
      autoY = Math.sin(t * 1.1 + 0.5) * 0.14
            + Math.sin(t * 2.0 + 1.2) * 0.06
            + Math.sin(t * 3.1 + 2.0) * 0.03;
    } else if (currentState === 'listening') {
      // Leve inclinación como prestando atención
      autoX = Math.sin(t * 0.8)       * 0.04;
      autoY = Math.sin(t * 0.6 + 0.3) * 0.05;
    }
    // Idle/processing: solo el float, sin rotación autónoma

    pivot.rotation.x = currentRotX + autoX;
    pivot.rotation.y = currentRotY + autoY;
    pivot.position.y = Math.sin(t * 0.75) * 0.035;
  }

  // Transición suave de luz frontal
  mainLight.color.lerp(targetColor, 0.06);
  mainLight.intensity += (targetIntensity - mainLight.intensity) * 0.06;

  // Transición suave de rim lights
  rimTop.color.lerp(targetRimColor, 0.06);
  rimLeft.color.lerp(targetRimColor, 0.06);
  rimRight.color.lerp(targetRimColor, 0.06);
  rimTop.intensity  += (targetRimInt - rimTop.intensity)  * 0.06;
  rimLeft.intensity += (targetRimInt - rimLeft.intensity) * 0.06;
  rimRight.intensity+= (targetRimInt - rimRight.intensity)* 0.06;

  // Pulso en estados activos
  if (currentState === 'speaking') {
    const p = 1 + Math.sin(t * 3.2) * 0.55;  // más rango, más frecuencia
    mainLight.intensity = targetIntensity * p;
    rimTop.intensity = rimLeft.intensity = rimRight.intensity = targetRimInt * p;
    // escala sutil — Vader "respira" al hablar
    if (pivot) pivot.scale.setScalar(1 + Math.sin(t * 3.2) * 0.025);
  } else if (currentState === 'listening') {
    const p = 1 + Math.sin(t * 6.0) * 0.35;
    mainLight.intensity = targetIntensity * p;
    rimTop.intensity = rimLeft.intensity = rimRight.intensity = targetRimInt * p;
    if (pivot) pivot.scale.setScalar(1 + Math.sin(t * 6.0) * 0.015);
  } else if (currentState === 'processing') {
    const p = 1 + Math.sin(t * 9.0) * 0.25;
    rimTop.intensity = rimLeft.intensity = rimRight.intensity = targetRimInt * p;
    if (pivot) pivot.scale.setScalar(1);
  } else {
    // Idle: respiración lenta — siempre visible, nunca apagado
    const breath = 1 + Math.sin(t * 0.9) * 0.55;
    rimTop.intensity = rimLeft.intensity = rimRight.intensity = targetRimInt * breath;
    if (pivot) pivot.scale.setScalar(1);
  }

  renderer.render(scene, camera);
}

animate();

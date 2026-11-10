import * as THREE from 'three';

// name, intensity, colour, [w, h], position. Values are the Task 3 starting point (tunable in Task 9).
const PANELS = [
  ['overhead', 6, '#ffffff', [6, 6], [0, 8, 0]],
  ['key', 10, '#ffffff', [1, 5], [-6, 4, 2]],
  ['rim', 8, '#ffffff', [1, 5], [6, 3, -3]],
  ['fill', 1.5, '#ffe6c7', [5, 2], [0, 1, 7]],
];

/**
 * Procedural product-photo studio: a dark backdrop sphere and four emissive softbox panels,
 * each aimed at the origin. Rendered once through PMREM; costs zero asset bytes (no textures).
 */
export function createStudioScene() {
  const scene = new THREE.Scene();

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(50, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#0d0f14', side: THREE.BackSide }),
  );
  scene.add(backdrop);

  for (const [name, intensity, color, [w, h], pos] of PANELS) {
    const material = new THREE.MeshBasicMaterial({ color });
    material.color.multiplyScalar(intensity);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    panel.position.set(...pos);
    panel.lookAt(0, 0, 0); // plane normal (+Z) now points at the origin
    panel.userData.panel = name;
    scene.add(panel);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

/** Frees every geometry and material in a studio scene. */
export function disposeStudioScene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

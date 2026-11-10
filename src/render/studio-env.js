import * as THREE from 'three';

// name, intensity, colour, [w, h], position. Task 9 tuning: the overhead softbox is larger and
// dimmer (a 6x6 panel at 6 drew a hard bar on every rounded bevel), and two large dim panels
// were added so polished metal reflects a bright studio instead of the black backdrop: a sweep
// behind and above (what a top face mirrors at the gallery's 52-degree view) and a table below
// the horizon (what lower faces mirror).
const PANELS = [
  ['overhead', 2.5, '#ffffff', [10, 10], [0, 8, 0]],
  ['key', 10, '#ffffff', [1, 5], [-6, 4, 2]],
  ['rim', 8, '#ffffff', [1, 5], [6, 3, -3]],
  ['fill', 1.5, '#ffe6c7', [5, 2], [0, 1, 7]],
  ['sweep', 0.9, '#ffffff', [18, 8], [0, 6, -7]],
  ['table', 0.5, '#e8e2d8', [24, 24], [0, -5, 0]],
];

/**
 * Procedural product-photo studio: a dark backdrop sphere and six emissive softbox panels,
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

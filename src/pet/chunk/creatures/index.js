import * as THREE from 'three';

/**
 * Placeholder creatures: a coloured rounded box that squashes and hops. Task 4 replaces this
 * module with the real mimic, slime and dragonling. A creature is
 * { root, height, pose(phase, t, reaction, look: {yaw}), dispose() }.
 * look.yaw is the yaw of the dice centre RELATIVE TO the body's current facing, in radians,
 * clamped to +-0.6 and 0 outside watch/react: a head or eyes turn by look.yaw to face the dice.
 * The layer already turns the body (smoothed), so a creature must not turn its whole root.
 */
function box(color) {
  const height = 1.2;
  const c = new THREE.Color(color || '#888888');
  c.r = Math.min(c.r, 1);
  c.g = Math.min(c.g, 1);
  c.b = Math.min(c.b, 1);
  const geo = new THREE.BoxGeometry(1, height, 1);
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  const root = new THREE.Group();
  root.add(mesh);
  return {
    root,
    height,
    pose(phase, t, reaction) {
      let squash = 0;
      let lift = 0;
      if (phase === 'throw') squash = Math.sin(t * Math.PI) * 0.15;
      else if (phase === 'react') {
        if (reaction === 'crit') lift = Math.abs(Math.sin(t * Math.PI * 2)) * 0.5 * height;
        else if (reaction === 'fumble') squash = 0.25 * Math.sin(Math.min(t * 4, 1) * Math.PI * 0.5);
        else squash = Math.sin(t * Math.PI) * 0.1;
      }
      mesh.scale.y = 1 - squash;
      mesh.scale.x = mesh.scale.z = 1 + squash * 0.5;
      mesh.position.y = (height * mesh.scale.y) / 2 + lift;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export const CREATURES = { mimic: box, slime: box, dragonling: box };

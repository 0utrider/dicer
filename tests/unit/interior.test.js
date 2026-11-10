import { interiorChunk, INTERIOR } from '../../src/render/shaders/interior.js';

const TYPES = ['liquid', 'glitter', 'swirl', 'nebula', 'shape'];
const SDF = { star: 'dcSdStar', heart: 'dcSdHeart', skull: 'dcSdSkull', sphere: 'dcSdSphere' };

test.each(TYPES)('%s: non-empty pars and main; main marches DICER_STEPS', (type) => {
  const c = interiorChunk(type, 'star');
  expect(c.pars.trim().length).toBeGreaterThan(0);
  expect(c.main.trim().length).toBeGreaterThan(0);
  expect(c.main).toContain('DICER_STEPS');
  expect(c.pars).toContain('uniform vec3 uInteriorColors[ 2 ]');
  expect(c.pars).toContain('uniform float uInteriorDensity');
  expect(c.pars).toContain('uniform vec3 uKeyLightDir');
  // the type's density function is defined and the march calls it
  expect(c.pars).toContain('vec4 dcInterior( vec3 p');
  expect(c.main).toContain('dcInterior(');
});

test('march: early-out at alpha >= 0.98, ray-volume miss skip, march radius 0.62', () => {
  const { main, pars } = interiorChunk('nebula');
  expect(INTERIOR.radius).toBeCloseTo(0.62);
  expect(main).toMatch(/>= 0\.98/);
  expect(main).toContain('break');
  expect(pars).toContain('0.6200');
  // the volume scales with the body ellipsoid (coin) and is skipped on a miss
  expect(pars).toContain('uResinRadii');
  expect(main).toMatch(/if \( dcIt\.y > dcIt\.x \)/);
});

test.each(Object.keys(SDF))('shape %s includes its SDF function', (shape) => {
  const { pars } = interiorChunk('shape', shape);
  expect(pars).toContain(`float ${SDF[shape]}(`);
  for (const [other, fn] of Object.entries(SDF))
    if (other !== shape) expect(pars).not.toContain(`float ${fn}(`);
});

test('glitter sparkles off the key light; nebula has a star field', () => {
  expect(interiorChunk('glitter').pars).toContain('uKeyLightDir');
  expect(interiorChunk('glitter').pars).toMatch(/reflect\(/);
  expect(interiorChunk('nebula').pars).toContain('dcHash13');
});

test('unknown type (or shape) throws', () => {
  expect(() => interiorChunk('lava')).toThrow();
  expect(() => interiorChunk('none')).toThrow();
  expect(() => interiorChunk('shape', 'cube')).toThrow();
});

test('shape: rounded profile, curvature shading and a soft silhouette', () => {
  const { pars } = interiorChunk('shape', 'star');
  // elliptical thickness profile instead of a flat extrusion
  expect(pars).toMatch(/halfT = [\d.]+ \* sqrt\(/);
  // key highlight, wrap diffuse, SDF ambient occlusion
  expect(pars).toContain('normalize( dcIKey + v )');
  expect(pars).toMatch(/float wrap = /);
  expect(pars).toMatch(/float ao = /);
  // grazing misses within DC_SHAPE_AA get partial coverage
  expect(pars).toContain('d < DC_SHAPE_AA');
  // orientation is a uniform (die tilt vs coin)
  expect(pars).toContain('uniform mat3 uShapeRot');
  expect(interiorChunk('shape', 'heart').pars).toMatch(/halfT = [\d.]+ \* sqrt\(/);
});

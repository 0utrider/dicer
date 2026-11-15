import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { JB2A_EFFECTS, customLayer, pickFile, urlFor, hueDistance } from '../../src/jb2a/chunk/catalogue.js';

const hex = (h) => new THREE.Color(h);

describe('JB2A catalogue', () => {
    it('has exactly the expected effect ids', () => {
        expect(Object.keys(JB2A_EFFECTS).sort()).toEqual(
            ['celebrate', 'fumble', 'frost', 'lightning', 'smoke', 'sparkles', 'shockwave', 'light-burst', 'embers', 'shatter'].sort()
        );
    });

    it('has well-formed layers', () => {
        for (const layers of Object.values(JB2A_EFFECTS)) {
            expect(layers.length).toBeGreaterThan(0);
            for (const l of layers) {
                expect(l.file.endsWith('.webm')).toBe(true);
                for (const v of l.variants ?? []) expect(v.file.endsWith('.webm')).toBe(true);
                expect(['table', 'over']).toContain(l.place);
                expect(l.size).toBeGreaterThan(0);
            }
        }
    });

    it('picks the variant nearest in hue', () => {
        const layer = JB2A_EFFECTS.shockwave[0];
        expect(pickFile(layer, hex('#4a8cff'))).toBe('Impact_04_Regular_Blue_400x400.webm');
        expect(pickFile(layer, hex('#ff9030'))).toBe('Impact_04_Regular_Orange_400x400.webm');
        expect(pickFile(layer, null)).toBe('Impact_04_Regular_Yellow_400x400.webm');
    });

    it('sends grey and white colours to a White variant, else the default file', () => {
        const particles = JB2A_EFFECTS.sparkles[1];
        const white = 'ParticlesOutward01_01_Regular_White_400x400.webm';
        expect(pickFile(particles, hex('#ffffff'))).toBe(white);
        expect(pickFile(particles, hex('#cccccc'))).toBe(white);
        const shock = JB2A_EFFECTS.shockwave[0];
        expect(pickFile(shock, hex('#ffffff'))).toBe('Impact_04_Regular_Yellow_400x400.webm');
    });

    it('ignores colour for layers without variants', () => {
        const layer = JB2A_EFFECTS.fumble[0];
        expect(pickFile(layer, hex('#4a8cff'))).toBe(layer.file);
    });

    it('measures hue distance around the circle', () => {
        expect(hueDistance(hex('#ff0000'), hex('#ff0010'))).toBeLessThan(0.05);
        expect(hueDistance(hex('#ff0000'), hex('#00ffff'))).toBeCloseTo(0.5, 2);
    });

    it('builds urls', () => {
        const layer = JB2A_EFFECTS.frost[0];
        expect(urlFor({ moduleId: 'jb2a_patreon', location: 'modules' }, layer, null)).toBe(
            'modules/jb2a_patreon/Library/Generic/Impact/FrostImpact_01_Regular_Blue_600x600.webm'
        );
        expect(urlFor({ moduleId: 'jb2a_patreon', location: 'https://bucket.example/' }, layer, null)).toBe(
            'https://bucket.example/jb2a_patreon/Library/Generic/Impact/FrostImpact_01_Regular_Blue_600x600.webm'
        );
    });

    it('customLayer: a chosen .webm path; flat for impact-like folders; urls only under the JB2A bucket', () => {
        const local = { moduleId: 'jb2a_patreon', location: 'modules' };
        const bucket = { moduleId: 'jb2a_patreon', location: 'https://bucket.example/' };
        const impact = customLayer('modules/jb2a_patreon/Library/Generic/Impact/Impact_01_Blue_400x400.webm', local);
        expect(impact).toMatchObject({ place: 'table', size: 7 });
        expect(urlFor(local, impact, new THREE.Color('#f00'))).toBe(impact.url);
        expect(customLayer('modules/jb2a_patreon/Library/1st_Level/Bless/Bless_01_Regular_Yellow_400x400.webm', local)).toMatchObject({ place: 'over', size: 6 });
        for (const bad of ['a.png', '../x.webm', 'a/../b.webm', '\\\\host\\x.webm', 'https://evil.example/x.webm', '//evil.example/x.webm', 5, null]) {
            expect(customLayer(bad, local)).toBeNull();
        }
        expect(customLayer('https://bucket.example/jb2a_patreon/x.webm', bucket)).not.toBeNull();
        expect(customLayer('https://evil.example/x.webm', bucket)).toBeNull();
    });
});

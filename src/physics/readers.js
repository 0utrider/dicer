import { getShape } from '../core/dice-shapes.js';
import { faceNormals } from '../core/face-reader.js';
import { flatGap, readSign } from '../core/physical-read.js';
import { HULL_TYPES } from './hulls.js';

/**
 * Main-thread helper: what the worker needs to tell a cocked die from a flat one (it has no shape
 * table): local face normals (flat xyz; the coin's two caps), the read set (null: every face), the
 * read side (-1: the face on the table, d4 and d16) and the flat gap. Plain data for the READERS
 * message, sent by the lazy hand chunk (its only importer: none of this is in world start).
 * @returns {Record<string, {normals: Float32Array, read: Int8Array|null, mode: 1|-1, gap: number}>}
 */
export function computeReaders(types = [...HULL_TYPES, 'd2']) {
  return Object.fromEntries(
    types.map((t) => {
      const s = getShape(t);
      const normals = new Float32Array(faceNormals(s).flatMap((n) => [n.x, n.y, n.z]));
      const read = s.readFaces ? Int8Array.from(s.readFaces) : null;
      return [t, { normals, read, mode: readSign(s), gap: flatGap(s) }];
    }),
  );
}

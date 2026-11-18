import { build } from '../../scripts/pets/build-ghost.js';
import { petModelChecks } from '../helpers/pet-model-checks.js';

petModelChecks('ghost', build, {
  bones: ['arm_L', 'arm_R', 'tail_1', 'tail_2', 'tail_3'],
  keys: ['squint_L', 'squint_R', 'puff'],
  color: '#b9c4e8',
});

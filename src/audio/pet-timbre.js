/**
 * Each dice pet kind's timbre: what its voice is made of, so a frog and an owl saying the same
 * "mm-hm" sound like two creatures, not one voice at two pitches. synth.js renderPetSound renders a
 * pet sound's notes with these in place of the sound's own (a pure, soft voice), then shapes the
 * result. Read by synth.js only (the lazy synth chunk).
 *
 * Source (per note): `harm` (harmonic amplitudes, 1st up), or `inharm` ([ratio, gain, decay factor]:
 * a struck, woody body), `sub` (an octave below), `fm` ([ratio, index]: a metallic, alien edge),
 * `tauMul` (notes ring shorter or longer), `am` ([Hz, depth]: a croak's or a growl's flutter),
 * `vib` ([Hz, depth]: an extra waver) and `breath` (whispered noise under the note).
 * Shaping (the whole sound): `formants` ([Hz, Q, gain]: vowel resonances, mixed with `dry` of the
 * original), `grit` (soft-clip drive) and `echo` ([s, feedback]).
 */
const saw = (n, tilt = 1) => Array.from({ length: n }, (_, k) => 1 / (k + 1) ** tilt);
const odd = (n, tilt = 1) => Array.from({ length: n }, (_, k) => (k % 2 ? 0 : 1 / (k + 1) ** tilt));

export const PET_TIMBRES = {
  // a wooden box: struck, hollow, knocking
  mimic: {
    inharm: [[1, 1, 0.5], [2.76, 0.8, 0.28], [5.4, 0.5, 0.16], [8.9, 0.3, 0.1], [13.3, 0.15, 0.06]],
    tauMul: 0.7,
    formants: [[700, 4, 1.4], [1900, 5, 1.0]],
    dry: 0.5,
    echo: [0.03, 0.35],
  },
  // gloopy: round, bubbling, wobbly
  slime: {
    harm: [1, 0.55, 0.3, 0.12],
    am: [13, 0.55],
    vib: [6.5, 0.045],
    formants: [[380, 3, 1.8], [900, 4, 0.5]],
    dry: 0.35,
  },
  // a little dragon: a raspy growl under its chirps
  dragonling: {
    harm: saw(10),
    sub: 0.45,
    am: [33, 0.45],
    breath: 0.08,
    formants: [[700, 3, 1.3], [1200, 4, 0.9], [2500, 5, 0.4]],
    dry: 0.3,
    grit: 2.2,
  },
  // a hollow, breathy "hoo"
  owl: {
    harm: odd(5, 1.6),
    breath: 0.09,
    formants: [[330, 4, 1.6], [760, 5, 0.6]],
    dry: 0.4,
  },
  // a buzzy, nasal croak
  frog: {
    harm: odd(11, 0.8),
    am: [42, 0.85],
    formants: [[480, 5, 1.4], [1100, 6, 1.0], [2300, 6, 0.4]],
    dry: 0.25,
    grit: 1.8,
  },
  // a whisper: mostly breath on a faint pure note, far away
  ghost: {
    harm: [1],
    breath: 0.7,
    vib: [3.5, 0.03],
    tauMul: 1.4,
    formants: [[900, 2, 1.2], [2400, 3, 0.6]],
    dry: 0.6,
    echo: [0.16, 0.4],
  },
  // a tiny squeaky toy: bright, thin, a quick flutter
  mushroom: {
    harm: [1, 0.8, 0.55, 0.3],
    fm: [2, 0.7],
    vib: [11, 0.02],
    formants: [[2600, 4, 1.4]],
    dry: 0.5,
  },
  // alien: metallic, ringing, warbling
  eye: {
    harm: [1, 0.3],
    fm: [1.414, 2.4],
    am: [8, 0.35],
    formants: [[1300, 6, 1.2]],
    dry: 0.6,
  },
  // rocks grinding: low, rough, gravelly
  golem: {
    harm: saw(8, 1.2),
    sub: 0.9,
    am: [17, 0.55],
    breath: 0.12,
    formants: [[300, 4, 1.6], [650, 5, 0.9]],
    dry: 0.25,
    grit: 3,
  },
  // a meow: rich and nasal, a bright "eow"
  cat: {
    harm: saw(12, 0.9),
    vib: [6, 0.018],
    formants: [[850, 5, 1.3], [1700, 6, 1.0], [2800, 6, 0.6]],
    dry: 0.2,
  },
  // a fox's yip: bright, breathy, a little hoarse
  fox: {
    harm: saw(9, 1.1),
    breath: 0.14,
    vib: [7, 0.02],
    formants: [[1000, 5, 1.3], [2200, 6, 0.8]],
    dry: 0.3,
    grit: 1.3,
  },
  // a paper lantern: papery rustle round a warm, hollow hum
  lantern: {
    harm: odd(7, 1.2),
    breath: 0.35,
    vib: [4.5, 0.025],
    formants: [[520, 3, 1.4], [1500, 4, 0.7]],
    dry: 0.45,
    echo: [0.09, 0.3],
  },
  // an imp: a nasal, cackling little rasp
  imp: {
    harm: saw(12, 0.8),
    am: [24, 0.35],
    formants: [[1100, 6, 1.4], [2600, 6, 0.8]],
    dry: 0.25,
    grit: 2,
  },
  // clockwork: a buzzy square tone with a metallic ring
  robot: {
    harm: odd(13, 0.9),
    fm: [3, 0.9],
    am: [55, 0.3],
    formants: [[900, 7, 1.2]],
    dry: 0.5,
  },
  // a jester doll: a bright, chiming toy voice
  jester: {
    inharm: [[1, 0.6, 0.6], [3.98, 0.35, 0.3], [6.2, 0.2, 0.2]],
    vib: [8, 0.025],
    formants: [[1800, 4, 1.2]],
    dry: 0.55,
  },  // a raven: a harsh, croaking caw
  raven: {
    harm: saw(10, 0.9),
    am: [38, 0.45],
    formants: [[1300, 5, 1.4], [2400, 5, 0.7]],
    dry: 0.3,
    grit: 2.4,
  },
  // a spider: a tiny, chittering squeak
  spider: {
    harm: saw(6, 1.4),
    am: [30, 0.25],
    vib: [9, 0.03],
    formants: [[2400, 6, 1.3], [3600, 6, 0.6]],
    dry: 0.4,
  },
  // a skull: a hollow voice from inside the bone, echoing
  skull: {
    harm: odd(9, 1.4),
    breath: 0.2,
    formants: [[420, 4, 1.5], [1100, 5, 0.6]],
    dry: 0.35,
    echo: [0.13, 0.4],
  },
  // a drone: a clean, two-tone digital chirp
  drone: {
    inharm: [[1, 0.7, 0.5], [2.01, 0.3, 0.3]],
    fm: [2, 0.4],
    formants: [[1500, 5, 1.1]],
    dry: 0.6,
  },
};

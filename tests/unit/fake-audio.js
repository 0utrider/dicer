// Minimal WebAudio fakes recording what the sound engine creates and starts.
export class FakeAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  copyToChannel(src) {
    this.data.set(src);
  }
}

class FakeNode {
  constructor() {
    this.outputs = [];
  }
  connect(node) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs = [];
  }
}

export class FakeGainNode extends FakeNode {
  constructor() {
    super();
    this.gain = { value: 1 };
  }
}

export class FakeBiquadNode extends FakeNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = { value: 350 };
    this.Q = { value: 1 };
    this.gain = { value: 0 };
  }
}

export class FakeSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
    this.playbackRate = { value: 1 };
    this.startedAt = null;
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0, offset, duration) {
    this.startedAt = when;
    this.offset = offset;
    this.duration = duration;
  }
  stop() {
    this.stopped = true;
  }
  /** The biquad filters between the source and the gain node, in order. */
  get filters() {
    const out = [];
    for (let n = this.outputs[0]; n; n = n.outputs[0]) if (n instanceof FakeBiquadNode) out.push(n);
    return out;
  }
  /** Product of every gain node on the way to the destination. */
  get totalGain() {
    let g = 1;
    let n = this.outputs[0];
    while (n) {
      if (n instanceof FakeGainNode) g *= n.gain.value;
      n = n.outputs[0];
    }
    return g;
  }
}

export class FakeAudioContext {
  constructor({ state = 'running', sampleRate = 48000 } = {}) {
    this.state = state;
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.sources = [];
    this.gains = [];
    this.stateLog = [state];
    this.decoded = [];
  }
  _set(state) {
    this.state = state;
    this.stateLog.push(state);
  }
  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGainNode();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return new FakeBiquadNode();
  }
  async decodeAudioData(bytes) {
    if (this.decodeFails) throw new Error('decode failed');
    this.decoded.push(bytes);
    return new FakeAudioBuffer(1, 480, this.sampleRate);
  }
  async resume() {
    this._set('running');
  }
  async suspend() {
    this._set('suspended');
  }
  async close() {
    this._set('closed');
  }
}

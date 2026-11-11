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

export class FakeSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
    this.playbackRate = { value: 1 };
    this.startedAt = null;
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
  /** Product of every gain node on the way to the destination. */
  get totalGain() {
    let g = 1;
    let n = this.outputs[0];
    while (n && n.gain) {
      g *= n.gain.value;
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

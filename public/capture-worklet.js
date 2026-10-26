class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [new Float32Array(2048), new Float32Array(2048)];
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const channels = this.buffers.map(buffer => buffer.slice(0, this.offset));
    this.port.postMessage({ channels }, channels.map(channel => channel.buffer));
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input?.length) return true;
    for (let i = 0; i < input[0].length; i++) {
      this.buffers[0][this.offset] = input[0][i];
      this.buffers[1][this.offset] = (input[1] || input[0])[i];
      if (++this.offset === 2048) this.flush();
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);

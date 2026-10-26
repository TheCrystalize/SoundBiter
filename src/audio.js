export class SampleBuffer {
  constructor(limit) { this.limit = limit; this.chunks = []; this.length = 0; }
  append(channels) {
    this.chunks.push(channels);
    this.length += channels[0].length;
    while (this.length > this.limit && this.chunks.length) {
      const excess = this.length - this.limit;
      const first = this.chunks[0];
      if (first[0].length <= excess) { this.chunks.shift(); this.length -= first[0].length; }
      else { this.chunks[0] = first.map(c => c.slice(excess)); this.length -= excess; }
    }
  }
  snapshot() {
    const channels = [new Float32Array(this.length), new Float32Array(this.length)];
    let offset = 0;
    for (const chunk of this.chunks) {
      channels.forEach((c, i) => c.set(chunk[i] || chunk[0], offset));
      offset += chunk[0].length;
    }
    return channels;
  }
}

export function processAudio(channels, sampleRate, options) {
  const length = channels[0].length;
  if (!length) return [];
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const threshold = 10 ** (options.threshold / 20);
  const active = [];
  for (let start = 0; start < length; start += window) {
    const end = Math.min(length, start + window);
    let loud = false;
    for (const channel of channels) {
      let energy = 0;
      for (let i = start; i < end; i++) energy += channel[i] ** 2;
      if (Math.sqrt(energy / (end - start)) >= threshold) loud = true;
    }
    if (loud) active.push([start, end]);
  }
  if (!active.length && (options.trim || options.mode !== 'keep')) return [];
  const padding = Math.round(options.padding * sampleRate);
  let regions;
  if (options.mode === 'keep') {
    regions = [[options.trim ? Math.max(0, active[0][0] - padding) : 0,
      options.trim ? Math.min(length, active.at(-1)[1] + padding) : length]];
  } else {
    regions = [];
    for (const [start, end] of active) {
      const previous = regions.at(-1);
      if (previous && start - previous[1] < options.gap * sampleRate) previous[1] = end;
      else regions.push([start, end]);
    }
    regions = regions.map(([a, b]) => [Math.max(0, a - padding), Math.min(length, b + padding)]);
    // Padding can make neighboring regions overlap: merge instead of duplicating samples.
    regions = regions.reduce((result, current) => {
      const previous = result.at(-1);
      if (previous && current[0] <= previous[1]) previous[1] = current[1];
      else result.push(current);
      return result;
    }, []);
    if (!options.trim) { regions[0][0] = 0; regions.at(-1)[1] = length; }
  }
  const cuts = regions.map(([start, end]) => channels.map(channel => {
    const out = channel.slice(start, end);
    if (options.fade) {
      const count = Math.min(Math.round(sampleRate * 0.005), Math.floor(out.length / 2));
      for (let i = 0; i < count; i++) { const gain = count > 1 ? i / (count - 1) : 0; out[i] *= gain; out[out.length - 1 - i] *= gain; }
    }
    return out;
  }));
  if (options.mode !== 'remove') return cuts;
  const combined = channels.map((_, c) => {
    const output = new Float32Array(cuts.reduce((sum, cut) => sum + cut[c].length, 0));
    let offset = 0;
    for (const cut of cuts) { output.set(cut[c], offset); offset += cut[c].length; }
    return output;
  });
  return [combined];
}

export function encodeWav(channels, rate, depth = 16) {
  const bytes = depth / 8;
  const dataSize = channels[0].length * channels.length * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels.length * bytes, true);
  view.setUint16(32, channels.length * bytes, true); view.setUint16(34, depth, true);
  text(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < channels[0].length; i++) for (const channel of channels) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    const value = Math.round(sample * (sample < 0 ? 2 ** (depth - 1) : 2 ** (depth - 1) - 1));
    if (depth === 16) view.setInt16(offset, value, true);
    else { view.setUint8(offset, value & 255); view.setUint8(offset + 1, (value >> 8) & 255); view.setUint8(offset + 2, (value >> 16) & 255); }
    offset += bytes;
  }
  return buffer;
}

export function safeFilename(name) {
  return (name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.(mp3|wav)$/i, '').replace(/[. ]+$/g, '').trim() || 'soundbite').slice(0, 120);
}

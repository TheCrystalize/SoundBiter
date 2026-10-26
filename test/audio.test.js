import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SampleBuffer, processAudio, encodeWav, safeFilename } from '../src/audio.js';
import { Mp3Encoder } from '@breezystack/lamejs';

const options = { trim: true, mode: 'keep', threshold: -40, gap: 0.3, padding: 0, fade: false };
const signal = () => { const c = new Float32Array(2000); c.fill(0.5, 200, 500); c.fill(0.5, 1200, 1500); return [c, c.slice()]; };

test('rolling buffer retains precisely the newest samples across chunk boundaries', () => {
  const buffer = new SampleBuffer(5);
  buffer.append([new Float32Array([1, 2, 3])]);
  buffer.append([new Float32Array([4, 5, 6, 7])]);
  assert.deepEqual([...buffer.snapshot()[0]], [3, 4, 5, 6, 7]);
  buffer.append([new Float32Array([8, 9, 10, 11, 12, 13])]);
  assert.deepEqual([...buffer.snapshot()[1]], [9, 10, 11, 12, 13]);
});
test('edge cleanup preserves internal pauses', () => {
  const [clip] = processAudio(signal(), 1000, options);
  assert.equal(clip[0].length, 1300);
  assert.equal(clip[0][400], 0);
});
test('silence removal joins only active regions', () => {
  const [clip] = processAudio(signal(), 1000, { ...options, mode: 'remove' });
  assert.equal(clip[0].length, 600);
  assert.ok(clip[0].every(x => x === 0.5));
});
test('split produces separate clips and preserves padding', () => {
  const cuts = processAudio(signal(), 1000, { ...options, mode: 'split', padding: 0.05 });
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0][0].length, 400);
  assert.equal(cuts[1][0].length, 400);
});
test('audio in either stereo channel is retained', () => {
  const channels = signal(); channels[0].fill(0);
  assert.equal(processAudio(channels, 1000, options)[0][0].length, 1300);
});
test('silence can be discarded or explicitly kept', () => {
  const silence = [new Float32Array(100)];
  assert.deepEqual(processAudio(silence, 1000, options), []);
  assert.equal(processAudio(silence, 1000, { ...options, trim: false })[0][0].length, 100);
});
test('overlapping padding merges regions without duplicate audio', () => {
  const cuts = processAudio(signal(), 1000, { ...options, mode: 'split', padding: 0.5 });
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0][0].length, 2000);
});
test('fades reach zero at both cut edges', () => {
  const [clip] = processAudio(signal(), 1000, { ...options, fade: true });
  assert.equal(clip[0][0], 0);
  assert.equal(clip[0].at(-1), 0);
  assert.equal(clip[0][5], 0.5);
});
test('WAV headers describe accurate sample rate, channels, depth, and size', () => {
  for (const depth of [16, 24]) {
    const buffer = encodeWav([new Float32Array([-1, 0, 1]), new Float32Array([1, 0, -1])], 48000, depth);
    const view = new DataView(buffer);
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 48000);
    assert.equal(view.getUint16(34, true), depth);
    assert.equal(view.getUint32(40, true), 6 * depth / 8);
    assert.equal(buffer.byteLength, 44 + 6 * depth / 8);
    if (depth === 16) assert.equal(view.getInt16(44, true), -32768);
    else assert.deepEqual([...new Uint8Array(buffer, 44, 3)], [0, 0, 128]);
  }
});
test('filenames remove path characters and duplicate extensions', () => {
  assert.equal(safeFilename('hello/world?.mp3'), 'hello-world-');
  assert.equal(safeFilename('   '), 'soundbite');
});
test('MP3 encoder produces MPEG frames at every offered bitrate and channel setting', () => {
  for (const channels of [1, 2]) for (const rate of [44100, 48000]) for (const bitrate of [64, 96, 128, 192, 256, 320]) {
    const encoder = new Mp3Encoder(channels, rate, bitrate);
    const samples = Int16Array.from({ length: 1152 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / rate) * 16000);
    const chunks = [];
    for (let i = 0; i < 5; i++) chunks.push(new Uint8Array(encoder.encodeBuffer(samples, channels === 2 ? samples : undefined)));
    chunks.push(new Uint8Array(encoder.flush()));
    const output = Buffer.concat(chunks);
    assert.ok(output.length > 100);
    assert.equal(output[0], 255);
    assert.equal(output[1] & 224, 224);
    const index = (output[2] >> 4) & 15;
    const mpeg1 = ((output[1] >> 3) & 3) === 3;
    const bitrates = mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    assert.equal(bitrates[index], bitrate);
  }
});

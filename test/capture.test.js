import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function processor() {
  let Processor;
  class AudioWorkletProcessor {
    constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
  }
  runInNewContext(readFileSync(new URL('../public/capture-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor, Float32Array,
    registerProcessor: (name, implementation) => { assert.equal(name, 'capture-processor'); Processor = implementation; },
  });
  return new Processor();
}

test('capture worklet batches PCM without changing stereo samples', () => {
  const capture = processor();
  for (let i = 0; i < 16; i++) capture.process([[new Float32Array(128).fill(0.5), new Float32Array(128).fill(-0.25)]]);
  assert.equal(capture.messages.length, 1);
  assert.equal(capture.messages[0].channels[0].length, 2048);
  assert.ok(capture.messages[0].channels[0].every(x => x === 0.5));
  assert.ok(capture.messages[0].channels[1].every(x => x === -0.25));
});

test('stop flush preserves partial final chunk and duplicates mono input', () => {
  const capture = processor();
  capture.process([[new Float32Array(128).fill(0.25)]]);
  capture.port.onmessage({ data: 'flush' });
  assert.equal(capture.messages[0].channels[0].length, 128);
  assert.deepEqual(capture.messages[0].channels[0], capture.messages[0].channels[1]);
  assert.equal(capture.messages[1].flushed, true);
});

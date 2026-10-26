import { Mp3Encoder } from '@breezystack/lamejs';
import { encodeWav } from './audio.js';
self.onmessage = ({ data: { channels, rate, format, bitrate, depth } }) => {
  try {
    let blob;
    if (format === 'wav') blob = new Blob([encodeWav(channels, rate, depth)], { type: 'audio/wav' });
    else {
      const encoder = new Mp3Encoder(channels.length, rate, bitrate);
      const pcm = channels.map(channel => Int16Array.from(channel, value => Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767))));
      const chunks = [];
      for (let i = 0; i < pcm[0].length; i += 1152) {
        const data = encoder.encodeBuffer(pcm[0].subarray(i, i + 1152), pcm[1]?.subarray(i, i + 1152));
        if (data.length) chunks.push(new Uint8Array(data));
      }
      const tail = encoder.flush();
      if (tail.length) chunks.push(new Uint8Array(tail));
      blob = new Blob(chunks, { type: 'audio/mpeg' });
    }
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error.message }); }
};

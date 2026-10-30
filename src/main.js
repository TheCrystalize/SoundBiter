import './style.css';
import { SampleBuffer, processAudio, encodeWav, safeFilename } from './audio.js';

const $ = id => document.getElementById(id);
const clips = [];
const MAX_CLIP_SECONDS = 600;
const MAX_RECORDING_SECONDS = 480;
const MAX_LIBRARY_SAMPLES = 48000 * 600; // Ten minutes of stereo PCM, across the library.
const opusSupported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
// A browser hint for guidance only; the returned audio tracks remain the capability check.
const firefox = /Firefox\//i.test(navigator.userAgent);
const firefoxHelp = 'Firefox can share the screen but does not currently share its audio. Open SoundBiter and the source audio tab in desktop Chrome or Edge, then select the tab and enable “Share tab audio”. Audio-file import still works here.';
let session = null;
let starting = false;
let stopping = false;
let sequence = 0;
let animation;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const time = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const cleanupOptions = () => ({ trim: $('trim').checked, mode: $('silence-mode').value, threshold: +$('threshold').value, gap: +$('gap').value, padding: +$('padding').value, fade: $('fade').checked });

function updateControls() {
  const capturing = !!session;
  $('start').disabled = capturing || starting || stopping || !navigator.mediaDevices?.getDisplayMedia;
  $('stop').disabled = !capturing || stopping;
  $('save').disabled = !capturing || stopping;
  $('mode').disabled = capturing || starting || stopping;
  $('buffer').disabled = capturing || starting || stopping;
  $('buffer-label').hidden = $('mode').value !== 'rolling';
  $('mode-help').textContent = $('mode').value === 'rolling'
    ? 'Always ready for “wait, save that.” Start capture before the moment happens.'
    : 'Record from start to stop. Automatically saves at 8 minutes.';
  const bufferSeconds = +$('buffer').value;
  $('save').textContent = $('mode').value === 'rolling' ? `＋ Save last ${bufferSeconds >= 60 ? `${bufferSeconds / 60} min` : `${bufferSeconds}s`}` : '＋ Save so far';
  $('capture-badge').textContent = capturing ? '● CAPTURING' : starting ? 'CHOOSE A TAB' : 'READY WHEN YOU ARE';
  $('capture-badge').classList.toggle('active', capturing);
}

function drawWave(canvas, samples, color = '#95e6b0') {
  const width = canvas.clientWidth || 500;
  const height = canvas.clientHeight || 64;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  const bars = Math.floor(width / 6);
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    if (samples?.length) {
      const from = Math.floor(i * samples.length / bars);
      const to = Math.max(from + 1, Math.floor((i + 1) * samples.length / bars));
      for (let j = from; j < to; j++) peak = Math.max(peak, Math.abs(samples[j] || 0));
    }
    const barHeight = Math.max(2, Math.min(1, peak) * height * 0.85);
    context.fillRect(i * 6, (height - barHeight) / 2, 3, barHeight);
  }
}

function animate() {
  if (!session) return;
  session.analyser.getFloatTimeDomainData(session.meter);
  drawWave($('live-wave'), session.meter);
  $('timer').textContent = time(session.total / session.context.sampleRate);
  animation = requestAnimationFrame(animate);
}

async function startCapture() {
  if (session || starting || stopping) return;
  starting = true;
  updateControls();
  status('Waiting for the browser sharing picker. Choose the tab playing your sound and enable “Share tab audio”.');
  let stream, context;
  try {
    // Voice processing is meant for microphones: keep the tab's audio unfiltered and in stereo.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio, preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'exclude' });
    if (!stream.getAudioTracks().length) throw new Error(firefox ? firefoxHelp : 'The browser shared video without audio. Choose a browser tab and enable “Share tab audio”. If that option is missing, open both SoundBiter and the source tab in desktop Chrome or Edge.');
    status('Audio sharing allowed. Starting the recorder…');
    // Record at the tab's own sample rate rather than the output device's, so samples are never resampled.
    const { sampleRate } = stream.getAudioTracks()[0].getSettings();
    context = new AudioContext(sampleRate ? { sampleRate } : {});
    await context.resume();
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const node = new AudioWorkletNode(context, 'capture-processor');
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    source.connect(node).connect(mute).connect(context.destination);
    const seconds = $('mode').value === 'rolling' ? +$('buffer').value : MAX_RECORDING_SECONDS;
    const current = { stream, context, source, node, analyser, mute, meter: new Float32Array(2048), buffer: new SampleBuffer(seconds * context.sampleRate), total: 0, flush: null };
    session = current;
    node.port.onmessage = ({ data }) => {
      if (data.flushed) { current.flush?.(); return; }
      if (!data.channels || session !== current) return;
      const channels = $('mode').value === 'record'
        ? data.channels.map(channel => channel.subarray(0, Math.max(0, MAX_RECORDING_SECONDS * context.sampleRate - current.total)))
        : data.channels;
      if (channels[0].length) current.buffer.append(channels);
      current.total += channels[0].length;
      if ($('mode').value === 'record' && current.total >= MAX_RECORDING_SECONDS * context.sampleRate && !stopping) stopCapture();
    };
    stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (session === current && !stopping) stopCapture(); }));
    $('source-label').textContent = 'Listening to your shared tab';
    $('scope-hint').textContent = $('mode').value === 'rolling' ? `Keeping the most recent ${seconds >= 60 ? `${seconds / 60} minutes` : `${seconds} seconds`}` : 'Recording · 8 minute limit';
    status('Capture started. Save a moment anytime, or stop to save the current recording.');
    animate();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
    status(error.name === 'NotAllowedError' ? 'Capture cancelled or permission denied. Your audio was not recorded.' : error.message, true);
  } finally { starting = false; updateControls(); }
}

async function stopCapture() {
  if (!session || stopping) return;
  stopping = true;
  updateControls();
  const current = session;
  try {
    current.source.disconnect();
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 500);
      current.flush = () => { clearTimeout(timeout); resolve(); };
      current.node.port.postMessage('flush');
    });
    saveSamples(current.buffer.snapshot(), current.context.sampleRate);
  } catch (error) { status(`Could not save the capture: ${error.message}`, true); }
  finally {
    session = null;
    cancelAnimationFrame(animation);
    current.stream.getTracks().forEach(track => track.stop());
    current.node.disconnect();
    await current.context.close();
    stopping = false;
    $('source-label').textContent = 'That’s a wrap.';
    $('scope-hint').textContent = 'Choose another tab whenever you’re ready';
    drawWave($('live-wave'));
    updateControls();
  }
}

function saveSamples(channels, rate, baseName) {
  if (channels[0].length < rate * 0.05) { status('Not enough audio yet. Let it play for a moment, then save again.', true); return; }
  const cuts = processAudio(channels, rate, cleanupOptions());
  if (!cuts.length) { status('Only silence detected. Lower the silence threshold or turn off silence cleanup to keep quiet audio.', true); return; }
  const existing = clips.reduce((sum, clip) => sum + clip.channels[0].length, 0);
  const added = cuts.reduce((sum, cut) => sum + cut[0].length, 0);
  if (existing + added > MAX_LIBRARY_SAMPLES || clips.length + cuts.length > 100) {
    status('The clip library is full (about 10 minutes or 100 clips). Download and remove some clips before saving more.', true); return;
  }
  for (const cut of cuts) {
    sequence++;
    const date = new Date();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const name = baseName ? `${baseName}${cuts.length > 1 ? `-${sequence}` : ''}` : `soundbite-${stamp}-${String(sequence).padStart(3, '0')}`;
    const clip = { id: sequence, channels: cut, rate, name, url: URL.createObjectURL(new Blob([encodeWav(cut, rate, 32)], { type: 'audio/wav' })), start: 0, end: cut[0].length / rate };
    clips.unshift(clip);
  }
  renderClips();
  status(`${cuts.length === 1 ? 'Soundbite saved' : `${cuts.length} soundbites saved`}. Preview, rename, and download below. Clips are kept only until this page closes.`);
}

function removeClip(clip) {
  clip.element?.querySelector('audio')?.pause();
  URL.revokeObjectURL(clip.url);
  clips.splice(clips.indexOf(clip), 1);
}

function renderClips() {
  const list = $('clip-list');
  list.querySelectorAll('audio').forEach(audio => audio.pause());
  list.replaceChildren();
  $('clip-count').textContent = clips.length;
  $('clear').disabled = !clips.length;
  if (!clips.length) {
    list.innerHTML = '<div class="empty"><span class="empty-icon">✂</span><h3>The good bits go here.</h3><p>Capture a moment or import an audio file.<br>Preview it, give it a name, and make it yours.</p></div>';
    return;
  }
  for (const clip of clips) {
    const card = document.createElement('article');
    card.className = 'clip';
    card.innerHTML = `<div class="clip-top"><span class="clip-number">${String(clip.id).padStart(2, '0')}</span><input class="clip-name" aria-label="Clip filename" maxlength="120" /><button class="delete" aria-label="Delete clip" title="Delete clip">×</button></div><canvas class="clip-wave" aria-label="Clip waveform"></canvas><audio controls preload="metadata" aria-describedby="preview-note-${clip.id}"></audio><p id="preview-note-${clip.id}" class="fine-print">Preview is lossless (32-bit float WAV at the clip’s sample rate). Downloads use your selected format and quality settings.</p><div class="clip-trim"><label>Start (s)<input class="clip-start" type="number" min="0" step="0.01" /></label><label>End (s)<input class="clip-end" type="number" min="0.01" step="0.01" /></label><span class="clip-duration"></span><button class="download secondary">Download ↧</button></div>`;
    const name = card.querySelector('.clip-name');
    name.value = clip.name;
    name.addEventListener('input', () => { clip.name = name.value; });
    const audio = card.querySelector('audio');
    audio.src = clip.url;
    audio.addEventListener('play', () => {
      list.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
      if (audio.currentTime < clip.start || audio.currentTime >= clip.end) audio.currentTime = clip.start;
    });
    audio.addEventListener('timeupdate', () => { if (audio.currentTime >= clip.end) audio.pause(); });
    const start = card.querySelector('.clip-start');
    const end = card.querySelector('.clip-end');
    start.value = clip.start.toFixed(2); end.value = clip.end.toFixed(2);
    const duration = clip.channels[0].length / clip.rate;
    // Match the two-decimal display: a rounded-up end would otherwise fail validation and block downloads.
    start.max = end.max = duration.toFixed(2);
    const updateDuration = () => { card.querySelector('.clip-duration').textContent = `${(clip.end - clip.start).toFixed(2)}s · ${Math.round(clip.rate / 1000 * 10) / 10} kHz`; };
    const changeTrim = event => {
      const nextStart = +start.value, nextEnd = +end.value;
      if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart < 0 || nextEnd > duration + 0.005 || nextEnd - nextStart < 0.01) {
        event.target.setCustomValidity('Use a start before the end, within this clip’s duration.'); event.target.reportValidity(); return;
      }
      start.setCustomValidity(''); end.setCustomValidity('');
      clip.start = nextStart; clip.end = Math.min(duration, nextEnd);
      audio.currentTime = clip.start;
      updateDuration();
    };
    start.addEventListener('change', changeTrim); end.addEventListener('change', changeTrim);
    card.querySelector('.delete').addEventListener('click', () => { removeClip(clip); renderClips(); status('Clip removed.'); });
    card.querySelector('.download').addEventListener('click', event => {
      if (!start.reportValidity() || !end.reportValidity()) return;
      downloadClip(clip, event.target);
    });
    clip.element = card;
    list.append(card);
    updateDuration();
    drawWave(card.querySelector('canvas'), clip.channels[0], '#30765b');
  }
}

async function prepareExport(clip, rate, mono) {
  const from = Math.round(clip.start * clip.rate);
  const to = Math.min(clip.channels[0].length, Math.round(clip.end * clip.rate));
  const sourceChannels = clip.channels.map(c => c.slice(from, to));
  const context = new OfflineAudioContext(mono ? 1 : sourceChannels.length, Math.max(1, Math.ceil((to - from) * rate / clip.rate)), rate);
  const buffer = context.createBuffer(mono ? 1 : sourceChannels.length, to - from, clip.rate);
  if (mono) {
    const mixed = buffer.getChannelData(0);
    for (let i = 0; i < mixed.length; i++) mixed[i] = sourceChannels.reduce((sum, c) => sum + c[i], 0) / sourceChannels.length;
  } else sourceChannels.forEach((c, i) => buffer.copyToChannel(c, i));
  const source = context.createBufferSource(); source.buffer = buffer;
  // Manual trims can introduce hard edges too.
  const gain = context.createGain();
  if ($('fade').checked) {
    const length = buffer.duration;
    const fade = Math.min(0.005, length / 2);
    gain.gain.setValueAtTime(0, 0); gain.gain.linearRampToValueAtTime(1, fade);
    gain.gain.setValueAtTime(1, length - fade); gain.gain.linearRampToValueAtTime(0, length);
  }
  source.connect(gain).connect(context.destination); source.start();
  const rendered = await context.startRendering();
  return Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
}

async function downloadClip(clip, button) {
  button.disabled = true; button.textContent = 'Encoding…';
  let worker;
  // Snapshot settings so changes during an export cannot mismatch the filename and encoder.
  const format = $('format').value;
  // Avoid resampling where the format allows: WAV takes any rate, and MP3 supports 48 kHz. Opus always runs at 48 kHz.
  const rate = format === 'opus' ? 48000 : format === 'mp3' ? (clip.rate >= 48000 ? 48000 : 44100) : $('rate').value === 'original' ? clip.rate : +$('rate').value;
  const settings = { rate, format, bitrate: +$('bitrate').value, depth: +$('depth').value };
  const name = safeFilename(clip.name);
  let opusContext;
  try {
    // Start/resume during the download gesture, before asynchronous preparation.
    if (settings.format === 'opus') { opusContext = new AudioContext({ sampleRate: 48000 }); await opusContext.resume(); }
    const channels = await prepareExport(clip, settings.rate, $('channels').value === 'mono');
    let blob;
    if (settings.format === 'opus') {
      status('Encoding Opus locally. This takes the length of the clip; keep this tab open.');
      blob = await encodeOpus(channels, opusContext, settings.bitrate, button);
    } else {
      worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' });
      blob = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.blob);
        worker.onerror = event => reject(new Error(event.message || 'The audio encoder could not start.'));
        worker.postMessage({ channels, ...settings }, channels.map(c => c.buffer));
      });
    }
    const extension = settings.format === 'opus' ? 'webm' : settings.format;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `${name}.${extension}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status(`Download ready: ${name}.${extension} · ${(blob.size / 1024).toFixed(0)} KB`);
  } catch (error) { status(`Export failed: ${error.message}`, true); }
  finally { worker?.terminate(); if (opusContext) await opusContext.close(); button.disabled = false; button.textContent = 'Download ↧'; }
}

function encodeOpus(channels, context, bitrate, button) {
  return new Promise((resolve, reject) => {
    const buffer = context.createBuffer(channels.length, channels[0].length, 48000);
    channels.forEach((c, i) => buffer.copyToChannel(c, i));
    const source = context.createBufferSource(); source.buffer = buffer;
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: bitrate * 1000 });
    const chunks = [];
    const began = context.currentTime;
    const interval = setInterval(() => { button.textContent = `Encoding ${Math.min(99, Math.round((context.currentTime - began) / buffer.duration * 100))}%`; }, 200);
    const cleanup = () => { clearInterval(interval); source.disconnect(); destination.stream.getTracks().forEach(track => track.stop()); };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { cleanup(); reject(new Error(event.error?.message || 'Opus encoding failed.')); };
    recorder.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: 'audio/webm;codecs=opus' })); };
    source.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    recorder.start(); source.start();
  });
}

$('start').addEventListener('click', startCapture);
$('stop').addEventListener('click', stopCapture);
$('save').addEventListener('click', () => { if (session) saveSamples(session.buffer.snapshot(), session.context.sampleRate); });
$('mode').addEventListener('change', updateControls);
$('buffer').addEventListener('change', updateControls);
$('threshold').addEventListener('input', () => { $('threshold-value').textContent = `${$('threshold').value} dB`; });
$('format').addEventListener('change', () => {
  $('bitrate-label').hidden = $('format').value === 'wav';
  $('depth-label').hidden = $('format').value !== 'wav';
  $('rate-label').hidden = $('format').value !== 'wav';
  $('export-note').textContent = {
    mp3: 'Export settings apply at download. MP3 chooses its sample rate to suit the bitrate. Higher bitrate cannot restore missing detail.',
    wav: 'Original sample rate with 32-bit float is lossless. 16-bit plays almost everywhere.',
    opus: 'Opus uses a target bitrate and exports in real time to WebM. Keep this tab open until it finishes.',
  }[$('format').value];
});
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  let context;
  $('import').disabled = true;
  try {
    if (file.size > 80 * 1024 * 1024) throw new Error('Please import a file smaller than 80 MB.');
    status('Opening your audio locally…');
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > MAX_CLIP_SECONDS) throw new Error('Please import audio shorter than 10 minutes.');
    const channels = [decoded.getChannelData(0).slice(), decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1)).slice()];
    saveSamples(channels, decoded.sampleRate, file.name.replace(/\.[^.]+$/, ''));
  } catch (error) { status(`Could not import audio: ${error.message}`, true); }
  finally { if (context) await context.close(); $('import').disabled = false; event.target.value = ''; }
});
$('clear').addEventListener('click', () => { [...clips].forEach(removeClip); renderClips(); status('Clip library cleared.'); });
window.addEventListener('beforeunload', event => { if (clips.length || session) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', () => { if (!session) drawWave($('live-wave')); clips.forEach(c => drawWave(c.element.querySelector('canvas'), c.channels[0], '#30765b')); });
updateControls();
$('opus-option').disabled = !opusSupported;
if (!opusSupported) $('opus-option').textContent = 'Opus (not supported here)';
drawWave($('live-wave'));
if (!navigator.mediaDevices?.getDisplayMedia) status('Tab capture is unavailable in this browser. Try desktop Chrome or Edge over HTTPS. You can still import audio files.', true);
if (firefox) {
  $('browser-notice').hidden = false;
  $('browser-notice').textContent = firefoxHelp;
}

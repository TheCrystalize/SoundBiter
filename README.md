# SoundBiter

Catch browser audio, cut the quiet, and download the good bit. A static, browser-only app for GitHub Pages. Audio is processed on your device, with no account, API keys, backend, or audio uploads.

## Features

- User-approved browser-tab audio capture (desktop Chrome/Edge recommended).
- Rolling 15/30-second or 1/2/5/8-minute buffer, or full recording up to 8 minutes.
- Save a clip while capture continues; stop automatically saves the current buffer.
- Import browser-decodable audio files, up to 80 MB and 10 minutes.
- RMS-based silence detection: trim edges, remove long pauses, or split at pauses. Adjustable threshold, silence duration, padding, and 5 ms fades.
- Waveforms, native playback, editable filenames, manual start/end times, and clip removal.
- MP3: 64/96/128/192/256/320 kbps using a bundled LAME encoder in a worker.
- Opus in WebM: selectable target bitrate where supported, encoded locally in real time.
- PCM WAV: 16/24-bit, 44.1/48 kHz. All formats offer mono/stereo. MP3 selects an appropriate sample rate for the chosen bitrate; low bitrates may use a lower sample rate.
- Bounded in-memory library (100 clips or about 10 minutes of stereo audio).

## Run locally

Requires Node.js 22.12+ (or supported newer release).

```sh
npm ci
npm run dev
```

Open the printed localhost URL. Capture requires HTTPS or localhost. Choose a **browser tab** in the browser sharing picker and enable **Share tab audio**. If the browser returns no audio track, the app explains how to retry. The picker requests video as required by the browser API, but video is never stored or exported.

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

The included workflow tests, builds, and deploys pushes to `main`. Set repository **Settings → Pages → Source → GitHub Actions**. Relative asset URLs support the `/SoundBiter/` project path.

## Important behavior

- Capture cannot recover audio from before you started sharing. A site cannot silently enumerate or capture other tabs.
- Capture support depends on browser/OS and the source. Import remains available when tab capture is unavailable.
- Firefox currently grants screen-sharing permission without providing an audio track. The app shows an upfront Firefox notice; use desktop Chrome/Edge for tab audio capture, with the source tab in the same browser. This limitation is tracked in [Mozilla bug 1541425](https://bugzilla.mozilla.org/show_bug.cgi?id=1541425).
- Silence cleanup is applied when saving or importing. Adjust it before creating the clip; existing clips keep their saved samples. Export settings apply when downloading.
- Audio preview uses a PCM WAV; MP3 compression is applied on download. Manual start/end times apply to playback and export.
- Opus exports take the length of the clip. Keep the page open until export completes. The result has a `.webm` extension; it is an audio-only WebM container, not an Ogg `.opus` file.
- Clips live in memory only. Download before closing or reloading. The page requests a leave warning while clips or a capture exist.
- Imported multichannel audio uses its first two channels; mono is duplicated for stereo preview. Mono export averages both channels.
- Automatic naming uses the date and a sequence number (or imported filename), not speech recognition.
- Background tabs may throttle the visual meter. Audio processing uses AudioWorklet; suspending the device or browser can interrupt capture.
- Uncompressed capture memory is bounded. Import decoding can temporarily use more memory than the resulting clip, so shorter inputs are preferred.
- Google Fonts is the only remote UI asset; system font fallbacks work without it. Audio never leaves the device.

## Implementation

Vite + vanilla JavaScript. AudioWorklet captures stereo PCM into a bounded buffer. Pure audio utilities perform silence cleanup and PCM WAV encoding. OfflineAudioContext resamples exports. A worker runs the bundled `@breezystack/lamejs` MP3 encoder. No runtime CDN scripts, cross-origin isolation, or server-side processing are needed.

See [third-party notices](THIRD_PARTY_NOTICES.md) for encoder licensing and source links.

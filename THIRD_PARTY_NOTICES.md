# Third-party software

SoundBiter bundles **@breezystack/lamejs 1.2.7**, a JavaScript port of the LAME MP3 encoder, by Alex Zhukov and contributors. It is distributed under LGPL-3.0.

- Package and corresponding source: https://github.com/shijinyu/lamejs
- Original project: https://github.com/zhuker/lamejs
- Exact published package source: https://registry.npmjs.org/@breezystack/lamejs/-/lamejs-1.2.7.tgz
- Upstream licensing notes are included at `public/LAME-LICENSE.txt` and deployed as `LAME-LICENSE.txt`.
- LGPL v3: https://www.gnu.org/licenses/lgpl-3.0.html (incorporates GPL v3: https://www.gnu.org/licenses/gpl-3.0.html).
- LAME project: https://lame.sourceforge.io/

The encoder is imported as a separate worker dependency. To use a modified encoder, replace the package in `package.json` with your local version and run `npm install` and `npm run build`. There is no restriction on modifying or replacing that component for personal use or debugging such changes.

The UI uses DM Sans and Manrope from Google Fonts under the SIL Open Font License, with local system-font fallbacks.

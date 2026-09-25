# Third-party distributions

## Scratch editor

- Package: `@scratch/scratch-gui` version **15.1.1**
- Source: https://github.com/scratchfoundation/scratch-editor
- Download: https://registry.npmjs.org/@scratch/scratch-gui/-/scratch-gui-15.1.1.tgz
- SHA-1 of the upstream archive: `053765aa0428471454876d51e7c1b1aa800b6e29`
- License: **AGPL-3.0-only**, as declared by the upstream package.
- Copyright and trademark notices: `vendor/package/LICENSE`, `vendor/package/TRADEMARK`.
- The official distribution is kept unmodified. The embedding and automation adapter live in `web/` and `server/`.
- The downloaded package includes its `src/` directory and source maps. Bundled dependency notices remain in `vendor/package/dist/*.LICENSE.txt`.

Scratch is a project of the Scratch Foundation. This independent application is not endorsed by the Scratch Foundation. The Scratch name and logo in the editor belong to their respective owners.

## Other components

React, React DOM, React Redux, Redux, Express, JSZip and Playwright retain their license files in `node_modules/`. Exact installed versions are recorded in `package-lock.json`. FFmpeg is executed from the user's existing installation and is not redistributed here.

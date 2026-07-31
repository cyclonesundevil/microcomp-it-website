# Three.js browser runtime

The Black Hole Playground vendors the browser runtime so the visualization
does not depend on a third-party CDN during use.

- Upstream package: `three`
- Version: `0.165.0`
- License: MIT; see `LICENSE`
- Source: `https://www.npmjs.com/package/three/v/0.165.0`

## Vendored files

| File | SHA-256 |
| --- | --- |
| `three.module.js` | `5916C8DFB5F4E3EEDE312DE305345868D4A0A8105383B080C6985565D6E79B46` |
| `addons/controls/OrbitControls.js` | `F260591EF315AA04888152E7F121865214E33FB54727145CF4E4445058DB1297` |

When updating Three.js, replace both runtime files from the same upstream
release, update these hashes, and rerun `node --test tests/*.test.js`.

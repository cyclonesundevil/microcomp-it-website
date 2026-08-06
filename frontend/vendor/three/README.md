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
| `three.module.js` | `61718C7D4F2C65BE011B954F51661079FBD3FA9839380CCE38CF71C06153EDDB` |
| `addons/controls/OrbitControls.js` | `0BF542ED8DBBC4253BFAAE96C2D56B7CDF1825409FE4EEB2C0959E347C2772B4` |

When updating Three.js, replace both runtime files from the same upstream
release, update these hashes, and rerun `node --test tests/*.test.js`.

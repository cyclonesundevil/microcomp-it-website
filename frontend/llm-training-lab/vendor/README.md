# Vendored TensorFlow.js runtime

The browser training worker uses the locally vendored TensorFlow.js Core
runtime for automatic differentiation and tensor kernels.

```text
Package: @tensorflow/tfjs
Version: 4.22.0
Artifact: dist/tf.min.js
Upstream: https://github.com/tensorflow/tfjs
License: Apache-2.0
Source URL: https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js
SHA-256: 300dfae273d20b4046f46a06d735688f03675a807561e9bcb5f664eb2f3d2831
```

The artifact is served from this repository. Training does not contact a CDN
at runtime.

To update it:

1. select and review an official TensorFlow.js release;
2. replace `tf.min.js` with that exact release artifact;
3. update the version, URL, and SHA-256 above;
4. rerun numerical, worker, memory, and browser compatibility tests; and
5. verify the Apache-2.0 license remains applicable.

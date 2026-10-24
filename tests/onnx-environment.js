/**
 * Jest environment for tests that run onnxruntime-node. The native addon makes typed arrays in
 * Node's own realm, and onnxruntime checks them with `instanceof` against the test sandbox's, so
 * the sandbox uses Node's typed arrays. Use with: @jest-environment ./tests/onnx-environment.js
 */
const { TestEnvironment } = require('jest-environment-node');

const TYPED = [
  'ArrayBuffer', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
];

class OnnxEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of TYPED) this.global[name] = globalThis[name];
  }
}

module.exports = OnnxEnvironment;

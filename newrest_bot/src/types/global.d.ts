// Global type declarations for Node.js
declare global {
  var console: Console;
  var process: NodeJS.Process;
  var Buffer: typeof Buffer;
  var setInterval: typeof setInterval;
  var clearInterval: typeof clearInterval;
  var setTimeout: typeof setTimeout;
  var clearTimeout: typeof clearTimeout;
  var setImmediate: typeof setImmediate;
  var clearImmediate: typeof clearImmediate;
  var require: NodeRequire;
  var module: NodeModule;
  var __dirname: string;
  var __filename: string;
  var global: typeof globalThis;
  var fetch: typeof fetch;
}

export {};

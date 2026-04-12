'use strict';

// Prints the next available brief ID (zero-padded, three digits) to stdout.
// Usage: node bridge/next-id.js

const path = require('path');
const { nextBriefId } = require('./watcher.js');

const queueDir = path.resolve(__dirname, 'queue');
console.log(nextBriefId(queueDir));

import test from 'node:test';
import assert from 'node:assert/strict';

import helpersFileio from '../helpers/fileio.js';
import threadModel from '../models/thread.js';
import hideUntilModel from '../models/hide_until.js';
import lastRefreshedModel from '../models/last_refreshed.js';
import messageModel from '../models/message.js';

test('backend modules load under ESM', () => {
  assert.equal(typeof helpersFileio.readJsonFromOptionalFile, 'function');
  assert.equal(typeof threadModel.get, 'function');
  assert.equal(typeof hideUntilModel.load, 'function');
  assert.equal(typeof lastRefreshedModel.load, 'function');
  assert.equal(typeof messageModel.Message, 'function');
});

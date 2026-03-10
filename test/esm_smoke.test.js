import test from 'node:test';
import assert from 'node:assert/strict';

import helpersFileio from '../helpers/fileio.js';
import threadModel from '../models/thread.js';
import hideUntilModel from '../models/hide_until.js';
import lastRefreshedModel from '../models/last_refreshed.js';
import messageModel from '../models/message.js';
import registerAuthRoutes from '../src/server/routes/auth_routes.js';
import registerGmailRoutes from '../src/server/routes/gmail_routes.js';
import registerSetupRoutes from '../src/server/routes/setup_routes.js';
import registerThreadRoutes from '../src/server/routes/thread_routes.js';
import gmailSyncService from '../src/server/services/gmail_sync_service.js';
import rfc2822Service from '../src/server/services/rfc2822_service.js';

test('backend modules load under ESM', () => {
  assert.equal(typeof helpersFileio.readJsonFromOptionalFile, 'function');
  assert.equal(typeof threadModel.get, 'function');
  assert.equal(typeof hideUntilModel.load, 'function');
  assert.equal(typeof lastRefreshedModel.load, 'function');
  assert.equal(typeof messageModel.Message, 'function');
  assert.equal(typeof registerAuthRoutes, 'function');
  assert.equal(typeof registerGmailRoutes, 'function');
  assert.equal(typeof registerSetupRoutes, 'function');
  assert.equal(typeof registerThreadRoutes, 'function');
  assert.equal(typeof gmailSyncService.syncRecentThreadsFromGmail, 'function');
  assert.equal(typeof rfc2822Service.buildRfc2822Message, 'function');
});

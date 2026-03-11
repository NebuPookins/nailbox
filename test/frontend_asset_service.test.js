import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { createFrontendAssetService } from '../src/server/services/frontend_asset_service.js';

test('assetPath resolves fingerprinted asset from manifest', async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), 'nailbox-assets-'));
	const manifestPath = path.join(tempDir, 'manifest.json');
	await writeFile(manifestPath, JSON.stringify({
		'main.js': '/public/assets/main-abc123.js',
	}));
	const assetService = createFrontendAssetService({ manifestPath });
	assert.equal(assetService.assetPath('main.js'), '/public/assets/main-abc123.js');
});

test('assetPath throws when manifest entry is missing', async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), 'nailbox-assets-'));
	const manifestPath = path.join(tempDir, 'manifest.json');
	await writeFile(manifestPath, JSON.stringify({}));
	const assetService = createFrontendAssetService({ manifestPath });
	assert.throws(() => assetService.assetPath('main.js'), /Missing frontend asset "main\.js"/);
});

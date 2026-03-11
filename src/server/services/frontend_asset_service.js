import fs from 'node:fs';
import path from 'path';

const DEFAULT_MANIFEST_PATH = path.join(process.cwd(), 'public', 'assets', 'manifest.json');

export function createFrontendAssetService(dependencies = {}) {
	const manifestPath = dependencies.manifestPath || DEFAULT_MANIFEST_PATH;

	function readManifest() {
		const manifestContents = fs.readFileSync(manifestPath, 'utf8');
		return JSON.parse(manifestContents);
	}

	function assetPath(assetName) {
		const manifest = readManifest();
		const resolvedPath = manifest[assetName];
		if (typeof resolvedPath !== 'string') {
			throw new Error(`Missing frontend asset "${assetName}" in ${manifestPath}`);
		}
		return resolvedPath;
	}

	return {
		assetPath,
		readManifest,
	};
}

const frontendAssetService = createFrontendAssetService();

export default frontendAssetService;

import fs from 'node:fs';
import path from 'path';

const DEFAULT_MANIFEST_PATH = path.join(process.cwd(), 'public', 'assets', 'manifest.json');

export function createFrontendAssetService(dependencies: {
	manifestPath?: string;
} = {}) {
	const manifestPath = dependencies.manifestPath || DEFAULT_MANIFEST_PATH;

	function readManifest(): Record<string, string> {
		const manifestContents = fs.readFileSync(manifestPath, 'utf8');
		return JSON.parse(manifestContents) as Record<string, string>;
	}

	function assetPath(assetName: string): string {
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

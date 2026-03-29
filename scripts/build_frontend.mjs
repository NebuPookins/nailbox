import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build, context } from 'esbuild';

const args = new Set(process.argv.slice(2));
const isWatchMode = args.has('--watch');
const projectRoot = process.cwd();
const outdir = path.join(projectRoot, 'public', 'assets');
const manifestPath = path.join(outdir, 'manifest.json');

function publicPathForOutput(outputPath) {
	return `/public/assets/${path.basename(outputPath)}`;
}

function createManifestPlugin() {
	return {
		name: 'manifest-writer',
		setup(buildContext) {
			buildContext.onEnd(async (result) => {
				if (result.errors.length > 0 || !result.metafile) {
					return;
				}
				const manifest = {};
				for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
					if (!output.entryPoint) {
						continue;
					}
					manifest[path.basename(output.entryPoint)] = publicPathForOutput(outputPath);
				}
				await mkdir(outdir, { recursive: true });
				await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
			});
		},
	};
}

const buildOptions = {
	bundle: true,
	define: {
		'process.env.NODE_ENV': JSON.stringify(isWatchMode ? 'development' : 'production'),
	},
	entryNames: '[name]-[hash]',
	entryPoints: {
		'main': path.join(projectRoot, 'src', 'frontend', 'main.ts'),
	},
	format: 'iife',
	logLevel: 'info',
	metafile: true,
	minify: !isWatchMode,
	outdir,
	plugins: [createManifestPlugin()],
};

await mkdir(outdir, { recursive: true });

if (isWatchMode) {
	const buildContext = await context(buildOptions);
	await buildContext.watch();
	console.log('Watching frontend assets...');
} else {
	await build(buildOptions);
}

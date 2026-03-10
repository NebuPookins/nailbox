import fileio from '../../../helpers/fileio.js';
import { normalizeAppConfig } from '../validation/contracts.js';

const DEFAULT_CONFIG_PATH = 'data/config.json';

/**
 * @param {{
 *  fileioImpl?: typeof fileio,
 *  pathToConfig?: string,
 * }} [dependencies]
 * @returns {import('../types/config').ConfigRepository}
 */
export function createConfigRepository(dependencies = {}) {
	const {
		fileioImpl = fileio,
		pathToConfig = DEFAULT_CONFIG_PATH,
	} = dependencies;

	async function readConfig() {
		const rawConfig = await fileioImpl.readJsonFromOptionalFile(pathToConfig);
		return normalizeAppConfig(rawConfig);
	}

	async function saveConfig(config) {
		const normalizedConfig = normalizeAppConfig(config);
		await fileioImpl.saveJsonToFile(normalizedConfig, pathToConfig);
		return normalizedConfig;
	}

	return {
		readConfig,
		saveConfig,
	};
}

const configRepository = createConfigRepository();

export default configRepository;

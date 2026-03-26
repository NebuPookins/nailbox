import fileio from '../../../helpers/fileio.js';
import {normalizeAppConfig} from '../validation/contracts.js';
import type {AppConfig, ConfigRepository} from '../types/config.js';

const DEFAULT_CONFIG_PATH = 'data/config.json';

export function createConfigRepository(dependencies: {
	fileioImpl?: typeof fileio;
	pathToConfig?: string;
} = {}): ConfigRepository {
	const {
		fileioImpl = fileio,
		pathToConfig = DEFAULT_CONFIG_PATH,
	} = dependencies;

	async function readConfig(): Promise<AppConfig> {
		const rawConfig = await fileioImpl.readJsonFromOptionalFile(pathToConfig);
		return normalizeAppConfig(rawConfig);
	}

	async function saveConfig(config: AppConfig): Promise<AppConfig> {
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

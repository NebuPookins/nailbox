import hideUntilModel from '../../../models/hide_until.js';

/**
 * @param {{
 *   hideUntilModelModule?: typeof hideUntilModel,
 * }} [dependencies]
 */
export function createHideUntilRepository(dependencies = {}) {
	const {
		hideUntilModelModule = hideUntilModel,
	} = dependencies;

	async function load() {
		return hideUntilModelModule.load();
	}

	return { load };
}

const hideUntilRepository = createHideUntilRepository();

export default hideUntilRepository;

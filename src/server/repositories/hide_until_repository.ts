import hideUntilModel from '../../../models/hide_until.js';

export function createHideUntilRepository(dependencies: {
	hideUntilModelModule?: typeof hideUntilModel;
} = {}) {
	const {
		hideUntilModelModule = hideUntilModel,
	} = dependencies;

	async function load() {
		return hideUntilModelModule.load();
	}

	return {load};
}

const hideUntilRepository = createHideUntilRepository();

export default hideUntilRepository;

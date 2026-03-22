import { createAppApi, createGroupingRulesApi } from './api.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.jsx';
import { mountLabelPickerIsland } from './label_picker_island.jsx';
import { mountLaterPickerIsland } from './later_picker_island.jsx';
import { mountThreadListIsland } from './thread_list_island.jsx';

export function mountGroupingRulesSettings({ container, notify, onSaved }) {
	return mountGroupingRulesIsland({
		container,
		api: createGroupingRulesApi(),
		notify,
		onSaved,
	});
}

const frontendApi = {
	createAppApi,
	createGroupingRulesApi,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLabelPickerIsland,
	mountLaterPickerIsland,
	mountThreadListIsland,
};

if (typeof window !== 'undefined') {
	window.NailboxFrontend = frontendApi;
	window.NailboxGroupingRules = {
		mount: mountGroupingRulesIsland,
		mountGroupingRulesIsland,
	};
	window.NailboxLaterPicker = {
		mount: mountLaterPickerIsland,
		mountLaterPickerIsland,
	};
	window.NailboxLabelPicker = {
		mount: mountLabelPickerIsland,
		mountLabelPickerIsland,
	};
}

export default frontendApi;

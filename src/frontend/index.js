// @ts-nocheck
import { createAppApi, createGroupingRulesApi } from './api.js';
import { mountAuthShellIsland } from './auth_shell_island.tsx';
import { mountGroupingRulesIsland } from './grouping_rules_island.tsx';
import { mountLabelPickerIsland } from './label_picker_island.tsx';
import { mountLaterPickerIsland } from './later_picker_island.tsx';
import { mountThreadListIsland } from './thread_list_island.tsx';
import { mountThreadViewerIsland } from './thread_viewer_island.tsx';

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
	mountAuthShellIsland,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLabelPickerIsland,
	mountLaterPickerIsland,
	mountThreadListIsland,
	mountThreadViewerIsland,
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

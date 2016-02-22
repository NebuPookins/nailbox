(function() {
	'use strict';
	const DEFAULT_CONFIG = {
		port: 3000
	};

	function Config() {
		var data = {};
		function get(fieldName) {
			if (Object.keys(data).indexOf(fieldName) === -1) {
				return DEFAULT_CONFIG[fieldName];
			} else {
				return data[fieldName];
			}
		}
		this.get = get;
	}

	//TODO
})();
(function() {
	'use strict';

	const q = require('q');
	const nodeFs = require('node-fs');

	/**
	 * Returns a promise of a JSON structure representing the parsed contents of
	 * the file at the specified path. If the file does not exist, {} is returned.
	 */
	exports.readJsonFromOptionalFile = path => {
		return q.Promise(function(resolve, reject) {
			nodeFs.readFile(path, function(err, strFileContents) {
				if (err) {
					if (err.code === 'ENOENT') {
						logger.info(`No file found at ${path}, using empty json by default.`);
						resolve({});
					} else {
						reject(err);
					}
				} else {
					resolve(JSON.parse(strFileContents));
				}
			});
		});
	}
})();
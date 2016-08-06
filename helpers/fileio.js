(() => {
	'use strict';

	const logger = require('nebulog').make({filename: __filename, level: 'info'});
	const q = require('q');
	const nodeFs = require('node-fs');

	/**
	 * Returns a promise of a JSON structure representing the parsed contents of
	 * the file at the specified path. If the file does not exist, {} is returned.
	 */
	exports.readJsonFromOptionalFile = path => {
		return q.Promise((resolve, reject) => {
			logger.info(`Reading optional JSON from ${path}.`);
			nodeFs.readFile(path, (err, strFileContents) => {
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
	};

	/**
	 * Returns a promise. If the promise resolves successfully, then as a side
	 * effect the specified directory exists on the filesystem.
	 */
	exports.ensureDirectoryExists = (dir) => {
		return q.Promise((resolve, reject) => {
			const recursive = true;
			nodeFs.mkdir(dir, 0o0700, recursive, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve(dir);
				}
			});
		});
	};

	/**
	 * Returns a promise. If the promise resolves successfully, then as a side
	 * effect the data in json was serialized and saved to the provided path.
	 */
	exports.saveJsonToFile = (json, path) => {
		return q.Promise(function(resolve, reject) {
			nodeFs.writeFile(path, JSON.stringify(json), function(err) {
				if (err) {
					reject(err);
				} else {
					resolve(json);
				}
			});
		});
	};
})();

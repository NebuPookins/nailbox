(() => {
	'use strict';

	const q = require('q');

	function Thread(data) {
	}

	exports.Thread = Thread; //TODO: This is temporary; prefer to use the get factory method.

	/**
	 * Factory method. Returns a promise to a Thread object.
	 */
	exports.get = (id) => {
		return q.Promise((resolve, reject) => {
			nodeFs.readFile('data/threads/' + id, (err, strFileContents) => {
				if (err) {
					return reject(err);
				} else {
					var jsonFileContents;
					try {
						jsonFileContents = JSON.parse(strFileContents);
					} catch (e) {
						if (e instanceof SyntaxError) {
							logger.warn(`Failed to parse JSON from ${id}`);
						}
						return reject(e);
					}
					return resolve(new Thread(jsonFileContents));
				}
			});
		});
	}
	//TODO
})();
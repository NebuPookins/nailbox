module.exports = function(grunt) {
	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		jshint: {
			files: ['*.js','public/*.js','helpers/*.js','models/*.js'],
			options: {
				globals: {
					jQuery: true
				},
				esversion: 6
			}
		},
		nodemon: {
			dev: {
				script: 'main.js',
				options: {
					legacyWatch: true,
					ignore: ['data/*', 'public/*']
				}
			}
		},
	});

	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-nodemon');

	grunt.registerTask('default', ['jshint', 'nodemon']);
};

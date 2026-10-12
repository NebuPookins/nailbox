import path from 'node:path';
import util from 'node:util';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type Logger = Readonly<Record<LogLevel, (message: string, ...details: unknown[]) => void>>;

// Most severe first: a logger prints its own level and everything above it.
const LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

const LEVEL_COLORS = {
	error: 'red',
	warn: 'yellow',
	info: 'green',
	debug: 'blue',
} as const satisfies Record<LogLevel, Parameters<typeof util.styleText>[0]>;

/**
 * A console logger that prefixes each line with its level and the name of the
 * file it was logged from. Extra details are appended via util.inspect.
 */
export function createLogger({filename, level}: {filename: string; level: LogLevel}): Logger {
	const prefix = `[${path.basename(filename)}]`;
	const threshold = LEVELS.indexOf(level);
	const write = (messageLevel: LogLevel) => (message: string, ...details: unknown[]): void => {
		if (LEVELS.indexOf(messageLevel) > threshold) {
			return;
		}
		const label = util.styleText(LEVEL_COLORS[messageLevel], `${messageLevel}:`);
		console[messageLevel](label, prefix, message, ...details.map((detail) => util.inspect(detail)));
	};
	return {
		error: write('error'),
		warn: write('warn'),
		info: write('info'),
		debug: write('debug'),
	};
}

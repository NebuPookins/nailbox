export interface LaterPresetOption {
	/** A Bootstrap Icons name. */
	icon: string;
	label: string;
	value: string;
}

type HideUntilPresetResult = { type: 'timestamp'; value: number } | { type: 'when-i-have-time' } | null;

export const LATER_PRESET_OPTIONS: LaterPresetOption[] = [
	{
		icon: 'clock',
		label: 'Couple of Hours',
		value: 'hours',
	},
	{
		icon: 'lamp-fill',
		label: 'Coming Evening',
		value: 'evening',
	},
	{
		icon: 'moon-stars-fill',
		label: 'Tomorrow',
		value: 'tomorrow',
	},
	{
		icon: 'sunglasses',
		label: 'This Weekend',
		value: 'weekend',
	},
	{
		icon: 'briefcase-fill',
		label: 'Next Monday',
		value: 'monday',
	},
	{
		icon: 'calendar3',
		label: 'In a Month',
		value: 'month',
	},
	{
		icon: 'cloud-fill',
		label: 'Someday',
		value: 'someday',
	},
	{
		icon: 'list-task',
		label: 'When I have time',
		value: 'when-i-have-time',
	},
	{
		icon: 'pencil-fill',
		label: 'Pick a Date',
		value: 'custom',
	},
];

function withTime(date: Date, hours: number): Date {
	const nextDate = new Date(date.getTime());
	nextDate.setHours(hours, 0, 0, 0);
	return nextDate;
}

function addDays(date: Date, days: number): Date {
	const nextDate = new Date(date.getTime());
	nextDate.setDate(nextDate.getDate() + days);
	return nextDate;
}

function addMonths(date: Date, months: number): Date {
	const nextDate = new Date(date.getTime());
	nextDate.setMonth(nextDate.getMonth() + months);
	return nextDate;
}

function nextWeekdayAtHour(now: Date, weekday: number, hour: number): Date {
	const candidate = withTime(now, hour);
	const currentWeekday = candidate.getDay();
	let dayOffset = (weekday - currentWeekday + 7) % 7;
	if (dayOffset === 0 && candidate.getTime() < now.getTime()) {
		dayOffset = 7;
	}
	return addDays(candidate, dayOffset);
}

export function resolveHideUntilPreset(preset: string, now: Date = new Date()): HideUntilPresetResult {
	switch (preset) {
		case 'hours':
			return {
				type: 'timestamp',
				value: now.getTime() + (3 * 60 * 60 * 1000),
			};
		case 'evening': {
			const threeHoursFromNow = new Date(now.getTime() + (3 * 60 * 60 * 1000));
			const todaysEvening = withTime(now, 18);
			const targetDate = threeHoursFromNow.getTime() < todaysEvening.getTime()
				? todaysEvening
				: addDays(todaysEvening, 1);
			return {
				type: 'timestamp',
				value: targetDate.getTime(),
			};
		}
		case 'tomorrow':
			return {
				type: 'timestamp',
				value: addDays(withTime(now, 7), 1).getTime(),
			};
		case 'weekend':
			return {
				type: 'timestamp',
				value: nextWeekdayAtHour(now, 6, 7).getTime(),
			};
		case 'monday':
			return {
				type: 'timestamp',
				value: nextWeekdayAtHour(now, 1, 7).getTime(),
			};
		case 'month':
			return {
				type: 'timestamp',
				value: withTime(addMonths(now, 1), 7).getTime(),
			};
		case 'someday':
			return {
				type: 'timestamp',
				value: withTime(addMonths(now, 6), 7).getTime(),
			};
		case 'when-i-have-time':
			return { type: 'when-i-have-time' };
		case 'custom':
			return null;
		default:
			return null;
	}
}

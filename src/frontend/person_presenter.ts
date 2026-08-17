import type { PersonDto } from '../server/types/thread.js';

/**
 * Formats a person for display as `Name (email)`, falling back to whichever of
 * the two is present. Returns the empty string when neither is known.
 */
export function formatPerson(person: Partial<PersonDto> | undefined): string {
	const name = person && person.name ? person.name : '';
	const email = person && person.email ? person.email : '';
	if (!name && !email) {
		return '';
	}
	if (!name) {
		return email;
	}
	if (!email) {
		return name;
	}
	return name + ' (' + email + ')';
}

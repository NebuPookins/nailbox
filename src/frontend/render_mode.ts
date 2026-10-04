import { senderKeyFor, type RenderMode, type SenderRenderModes } from '../server/types/config.js';
import type { PersonDto } from '../server/types/thread.js';

const DEFAULT_RENDER_MODE: RenderMode = 'original';

/**
 * Identifies whose preference applies to a message: the sender's lower-cased
 * email address, or undefined when the message has no usable sender.
 */
export function senderKeyOf(from: ReadonlyArray<PersonDto | null>): string | undefined {
	const email = from.find((person) => person?.email)?.email;
	return email === undefined ? undefined : senderKeyFor(email);
}

/** The mode a message is shown in: its sender's saved preference, else the default. */
export function renderModeFor(modes: SenderRenderModes, from: ReadonlyArray<PersonDto | null>): RenderMode {
	const key = senderKeyOf(from);
	return (key !== undefined ? modes[key] : undefined) ?? DEFAULT_RENDER_MODE;
}

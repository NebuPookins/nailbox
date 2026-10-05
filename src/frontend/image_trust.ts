import type { TrustedImageSenders } from '../server/types/config.js';
import type { PersonDto, SenderVerification } from '../server/types/thread.js';
import type { RemoteContent } from './email_srcdoc.js';
import { senderKeyOf } from './render_mode.js';

interface MessageSender {
	messageId: string;
	from: ReadonlyArray<PersonDto | null>;
	senderVerification: SenderVerification;
}

/** The sender to offer "always load images" for: only a Gmail-verified one, else undefined. */
export function senderToTrustFor(message: Pick<MessageSender, 'from' | 'senderVerification'>): string | undefined {
	return message.senderVerification === 'verified' ? senderKeyOf(message.from) : undefined;
}

/**
 * Whether a message's remote images load: the user asked for this message, or
 * trusts its sender and Gmail vouches for this message.
 */
export function remoteContentFor(
	trusted: TrustedImageSenders,
	allowedMessageIds: ReadonlySet<string>,
	message: MessageSender,
): RemoteContent {
	const trustedSender = senderToTrustFor(message);
	const autoLoads = trustedSender !== undefined && trusted.includes(trustedSender);
	return allowedMessageIds.has(message.messageId) || autoLoads ? 'allowed' : 'blocked';
}

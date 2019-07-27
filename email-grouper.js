(() => {
	'use strict';

	/**
	 * Returns a map from a String label to a predicate that returns true if a
	 * given thread should be associated with the labeled group.
	 *
	 * Feel free to customize to your personal e-mail patterns.
	 */
	exports.predicateMap = {
		"Delivery Tracking": (thread) => {
			return [
				"Amazon.com"
			].some((senderName ) =>
				thread.senders.some((sender) => sender.name == senderName)
			);
		},
		"Game Deals": (thread) => {
			return [
				"IndieGala", "Humble Bundle", "Fanatical Coupons"
			].some((senderName ) =>
				thread.senders.some((sender) => sender.name == senderName)
			);
		},
		"Grubhub": (thread) => {
			return thread.senders.some((sender) => sender.name == "Grubhub");
		},
		"Job Offers": (thread) => {
			return thread.senders.some((sender) => sender.email == "inmail-hit-reply@linkedin.com");
		},
		"Twitch Stream Alerts": (thread) => {
			return thread.senders.some((sender) => sender.name == "Twitch");
		},
		"When Idle": (thread) => {
			return [
				"Daily Coding Problem", "Google Alerts", "Intel Gaming Access",
				"Longreads", "Medium Daily Digest", "Pocket", "Riot Games",
				"Twitch Developers", "YouTube"
			].some((senderName ) =>
				thread.senders.some((sender) => sender.name == senderName)
			);
		},
	};;
})();
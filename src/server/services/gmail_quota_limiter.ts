// Gmail allows 15,000 quota units per user per minute, shared by every call
// Nailbox makes: background syncs, manual syncs and user actions alike. This
// limiter is a token bucket weighted by each call's quota cost, so all of
// that traffic together stays under the limit instead of each caller keeping
// its own ad hoc cap.

// Refills at 12,000 units/minute, leaving headroom for Gmail's own
// accounting; worst case per minute is DEFAULT_BURST_UNITS on top of that.
const DEFAULT_UNITS_PER_SECOND = 200;
const DEFAULT_BURST_UNITS = 2000;

// Costs from https://developers.google.com/gmail/api/reference/quota. Calls
// not listed here are charged the most common cost.
const DEFAULT_COST = 10;
const COSTS: {method: string; path: RegExp; units: number}[] = [
	{method: 'GET', path: /^\/profile$/, units: 1},
	{method: 'GET', path: /^\/labels$/, units: 1},
	{method: 'GET', path: /^\/history$/, units: 2},
	{method: 'GET', path: /^\/messages\/[^/]+\/attachments\/[^/]+$/, units: 5},
	{method: 'POST', path: /^\/messages\/send$/, units: 100},
];

export function gmailRequestCost({method = 'GET', path}: {method?: string; path: string}): number {
	const match = COSTS.find((cost) => cost.method === method.toUpperCase() && cost.path.test(path));
	return match ? match.units : DEFAULT_COST;
}

export interface GmailQuotaLimiter {
	// Resolves once `units` can be spent without exceeding the rate. Callers
	// are served in arrival order.
	acquire(units: number): Promise<void>;
}

export function createGmailQuotaLimiter({
	unitsPerSecond = DEFAULT_UNITS_PER_SECOND,
	burstUnits = DEFAULT_BURST_UNITS,
	now = Date.now,
	sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
	unitsPerSecond?: number;
	burstUnits?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
} = {}): GmailQuotaLimiter {
	let availableUnits = burstUnits;
	let refilledAt = now();
	let queue: Promise<void> = Promise.resolve();

	function refill(): void {
		const currentTime = now();
		availableUnits = Math.min(burstUnits, availableUnits + (currentTime - refilledAt) * unitsPerSecond / 1000);
		refilledAt = currentTime;
	}

	function acquire(units: number): Promise<void> {
		// A call costing more than the bucket holds would otherwise wait forever.
		const cost = Math.min(units, burstUnits);
		const turn = queue.then(async () => {
			refill();
			if (availableUnits < cost) {
				await sleep(Math.ceil((cost - availableUnits) * 1000 / unitsPerSecond));
				refill();
			}
			availableUnits -= cost;
		});
		queue = turn;
		return turn;
	}

	return {acquire};
}

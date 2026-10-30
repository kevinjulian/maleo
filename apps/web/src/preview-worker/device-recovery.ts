/** Same stationary-playback policy as the reference transport: 1.5 seconds, two attempts. */
export function createDeviceRecovery(options: {
	retry(): Promise<boolean>;
	failed(message: string): void;
	changed(): void;
	after(ms: number, run: () => void): () => void;
}) {
	let active = false,
		closed = false,
		sequence = 0;
	let cancelTimeout: (() => void) | undefined;
	function start() {
		if (closed || active) return;
		active = true;
		let attempts = 0;
		function attempt() {
			if (closed || !active) return;
			if (attempts === 2) {
				active = false;
				options.failed("WebGPU recovery failed after two attempts");
				return;
			}
			attempts++;
			const current = ++sequence;
			const failed = () => {
				if (closed || !active || sequence !== current) return;
				sequence++;
				cancelTimeout?.();
				attempt();
			};
			cancelTimeout = options.after(1500, failed);
			let retry: Promise<boolean>;
			try {
				retry = options.retry();
			} catch {
				failed();
				return;
			}
			void retry.then((accepted) => {
				if (closed || !active || sequence !== current) return;
				if (!accepted) {
					failed();
					return;
				}
				cancelTimeout?.();
				active = false;
				options.changed();
			}, failed);
		}
		attempt();
	}
	return {
		start,
		dispose() {
			closed = true;
			active = false;
			sequence++;
			cancelTimeout?.();
		},
	};
}

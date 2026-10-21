/* Shared process boundary: spawn, feed stdin, capture output, enforce a timeout,
 * honour caller aborts. Both runner modes go through this. */
import { spawn } from "node:child_process";

export interface SpawnOptions {
	timeoutMs: number;
	signal?: AbortSignal;
	stdin?: string;
	cwd?: string;
	label: string;
}

export interface SpawnResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export function spawnCapture(
	command: string,
	args: string[],
	options: SpawnOptions,
): Promise<SpawnResult> {
	return new Promise<SpawnResult>((resolve, reject) => {
		// No shell: the command and args come from configuration, never a prompt.
		const child = spawn(command, args, {
			env: process.env,
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const kill = (): void => {
			child.kill("SIGTERM");
		};

		const timer = setTimeout(() => {
			finish(() => reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms`)));
			kill();
		}, options.timeoutMs);
		const onAbort = (): void => {
			finish(() => reject(new Error(`${options.label} aborted`)));
			kill();
		};
		if (options.signal?.aborted) {
			finish(() => reject(new Error(`${options.label} aborted`)));
			kill();
			return;
		}
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			finish(() =>
				reject(
					new Error(`${options.label} could not start "${command}": ${error.message}`, {
						cause: error,
					}),
				),
			);
		});
		child.on("close", (code) => {
			finish(() => resolve({ code, stdout, stderr }));
		});
		child.stdin.on("error", () => {});
		child.stdin.end(options.stdin ?? "");
	});
}

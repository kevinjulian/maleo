import { expect, test } from "vite-plus/test";
import { uploadPhase } from "./upload-card.tsx";

const row = (status: "queued" | "uploading" | "processing" | "ready", progress?: number) => ({
	key: "k",
	filename: "a.mp4",
	batchSize: 1,
	status,
	retryable: true,
	progress,
});

test("upload cards say what is happening and only show a percentage they measured", () => {
	expect(uploadPhase(row("queued"))).toEqual({ label: "Queued", value: null });
	expect(uploadPhase(row("uploading"))).toEqual({ label: "Uploading 0%", value: 0 });
	expect(uploadPhase(row("uploading", 0.4))).toEqual({ label: "Uploading 40%", value: 40 });
	expect(uploadPhase(row("uploading", 1))).toEqual({ label: "Finishing upload", value: null });
	expect(uploadPhase(row("processing", 1))).toEqual({ label: "Processing", value: null });
	expect(uploadPhase(row("ready", 1))).toEqual({ label: "Ready", value: null });
});

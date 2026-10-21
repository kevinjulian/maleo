import { setupLocalWhisper } from "./whisper.ts";

const status = await setupLocalWhisper();
if (!status.ready)
	throw new Error("Whisper setup incomplete; check runtime, model and FFmpeg on media worker");
console.log(`Whisper ${status.version}, ${status.model}: ready on media worker`);

/* Media worker process — a thin shell. All logic lives in @maleo/media
 * (worker.ts + generation/*). This deployable just boots it: hosts the
 * generation-run Inngest function + producer/poll API + BrowserOS sessions. */
import { startMediaWorker } from "@maleo/media/worker";

await startMediaWorker();

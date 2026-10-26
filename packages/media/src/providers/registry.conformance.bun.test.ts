/* Every registered provider, checked against the seam contract. This runs even
 * for a provider whose own package has no test file. */
import { describe, expect, test, setDefaultTimeout } from "bun:test";
import { describeRegistryConformance } from "./conformance.ts";
import { PROVIDERS } from "./registry.ts";

// Codex health has a 10-second deadline and is probed twice.
setDefaultTimeout(30_000);

describeRegistryConformance({ describe, test, expect }, PROVIDERS, "PROVIDERS");

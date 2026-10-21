/* Every registered provider, checked against the seam contract. This runs even
 * for a provider whose own package has no test file. */
import { describe, expect, test } from "bun:test";
import { describeRegistryConformance } from "./conformance.ts";
import { PROVIDERS } from "./registry.ts";

describeRegistryConformance({ describe, test, expect }, PROVIDERS, "PROVIDERS");

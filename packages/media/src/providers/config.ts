/* The configuration seam lives in `@maleo/shared` so that ONE source installed
 * by a host serves every package that resolves provider configuration — media,
 * text providers and the research registry in apps/api. Separate module-level
 * seams would make a host install the same source more than once.
 *
 * Re-exported here so this package's own imports keep their local path. */
export {
	environmentConfigSource,
	getConfigSource,
	refreshConfig,
	resolveConfig,
	setConfigSource,
	withConfigOverride,
	type ConfigResolver,
	type ConfigSource,
} from "@maleo/shared/provider-config";

#!/usr/bin/env bun
/* Print a fresh MALEO_MASTER_KEY.
 *
 * For DEPLOYMENTS. Running locally you need none of this: a key is created for
 * you at `data/master.key` the first time you save a credential. This exists for
 * the case that file cannot be relied on — a container whose data directory is
 * not a persistent volume — where the key belongs in the platform's environment
 * instead, and takes precedence over the file.
 *
 * Generated here rather than invented by an operator because a passphrase is the
 * weak half of any scheme that accepts one. */
import { encodeKey, generateKey } from "../packages/db/src/db/secret-crypto.ts";

const key = encodeKey(generateKey());

console.log(key);
console.error("");
console.error("Set this as MALEO_MASTER_KEY in your deployment's environment.");
console.error("It encrypts every credential stored through Settings, and it is the");
console.error("one value to back up: without it those credentials cannot be read.");
console.error("");
console.error("Running locally you do not need this: a key is created at");
console.error("data/master.key the first time you save a credential. Use this when");
console.error("that directory is not a persistent volume — the environment wins.");

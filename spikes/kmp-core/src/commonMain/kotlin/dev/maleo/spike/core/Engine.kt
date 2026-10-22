package dev.maleo.spike.core

/** An engine error. The message is the engine's error JSON, `{"kind", "message"}`. */
class EngineException(message: String) : Exception(message)

/**
 * `maleo-editor-core` behind the editor-wasm calling convention: UTF-8 JSON in,
 * UTF-8 JSON out, a document behind a handle. One thread calls it.
 */
expect object Engine {
    /** Opens a document and returns its handle. */
    fun open(scope: String): Int

    /** Executes a command on the handle's document and returns its inverse. */
    fun execute(handle: Int, command: String): String

    /** The handle's document as JSON. */
    fun read(handle: Int): String

    fun close(handle: Int)

    fun openCount(): Int

    /** Live Rust heap bytes (spike measurement only). */
    fun liveBytes(): Long
}

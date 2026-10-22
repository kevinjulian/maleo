@file:OptIn(ExperimentalForeignApi::class)

package dev.maleo.spike.core

import dev.maleo.spike.core.native.engine_alloc
import dev.maleo.spike.core.native.engine_close
import dev.maleo.spike.core.native.engine_execute
import dev.maleo.spike.core.native.engine_open
import dev.maleo.spike.core.native.engine_open_count
import dev.maleo.spike.core.native.engine_output_len
import dev.maleo.spike.core.native.engine_output_ptr
import dev.maleo.spike.core.native.engine_read
import dev.maleo.spike.core.native.spike_live_bytes
import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.UByteVar
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.readBytes
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import platform.posix.memcpy

/** iOS reaches the C ABI through cinterop, linked from the Rust staticlib. */
actual object Engine {
    /** Copies [text] into an engine-owned buffer; the call takes ownership. */
    private fun <T> withInput(text: String, call: (CPointer<UByteVar>, ULong) -> T): T {
        val bytes = text.encodeToByteArray()
        val ptr = engine_alloc(bytes.size.convert()) ?: throw EngineException("engine_alloc returned null")
        if (bytes.isNotEmpty()) bytes.usePinned { memcpy(ptr, it.addressOf(0), bytes.size.convert()) }
        return call(ptr, bytes.size.convert())
    }

    private fun output(): String {
        val len = engine_output_len().toInt()
        if (len == 0) return ""
        return engine_output_ptr()!!.reinterpret<ByteVar>().readBytes(len).decodeToString()
    }

    private fun checked(status: UInt): String = if (status == 0u) output() else throw EngineException(output())

    actual fun open(scope: String): Int {
        val handle = withInput(scope) { ptr, len -> engine_open(ptr, len) }
        if (handle == 0u) throw EngineException(output())
        return handle.toInt()
    }

    actual fun execute(handle: Int, command: String): String =
        checked(withInput(command) { ptr, len -> engine_execute(handle.toUInt(), ptr, len) })

    actual fun read(handle: Int): String = checked(engine_read(handle.toUInt()))

    actual fun close(handle: Int) {
        checked(engine_close(handle.toUInt()))
    }

    actual fun openCount(): Int = engine_open_count().toInt()

    actual fun liveBytes(): Long = spike_live_bytes()
}

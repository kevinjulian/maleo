package dev.maleo.spike.core

/** The JNI shim in `rust/src/jni_shim.rs`; each call crosses into the C ABI once. */
internal object NativeEngine {
    init {
        System.loadLibrary("maleo_kmp_core")
    }

    @JvmStatic external fun open(scope: String): Int

    @JvmStatic external fun execute(handle: Int, command: String): String

    @JvmStatic external fun read(handle: Int): String

    @JvmStatic external fun close(handle: Int): String

    @JvmStatic external fun openCount(): Int

    @JvmStatic external fun liveBytes(): Long
}

/** Android reaches the C ABI through a thin JNI shim. */
actual object Engine {
    actual fun open(scope: String): Int = NativeEngine.open(scope)

    actual fun execute(handle: Int, command: String): String = NativeEngine.execute(handle, command)

    actual fun read(handle: Int): String = NativeEngine.read(handle)

    actual fun close(handle: Int) {
        NativeEngine.close(handle)
    }

    actual fun openCount(): Int = NativeEngine.openCount()

    actual fun liveBytes(): Long = NativeEngine.liveBytes()
}

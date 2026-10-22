package dev.maleo.spike.core

import android.os.Debug

actual val platformName: String = "android-emulator"

/** `build/fixtures` is a resource directory of the device test APK. */
actual fun fixtureText(name: String): String =
    EngineSpikeTest::class.java.classLoader!!.getResourceAsStream(name)?.use { it.readBytes().decodeToString() }
        ?: error("missing resource $name")

/** Native heap in use: where the Rust engine allocates. */
actual fun processMemoryBytes(): Long {
    Runtime.getRuntime().gc()
    return Debug.getNativeHeapAllocatedSize()
}

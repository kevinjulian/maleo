@file:OptIn(ExperimentalForeignApi::class)

package dev.maleo.spike.core

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.sizeOf
import kotlinx.cinterop.toKString
import kotlinx.cinterop.value
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.stringWithContentsOfFile
import platform.darwin.KERN_SUCCESS
import platform.darwin.TASK_VM_INFO
import platform.darwin.integer_tVar
import platform.darwin.mach_msg_type_number_tVar
import platform.darwin.mach_task_self_
import platform.darwin.task_info
import platform.darwin.task_vm_info_data_t
import platform.posix.getenv

actual val platformName: String = "ios-simulator"

actual fun fixtureText(name: String): String {
    val dir = getenv("SPIKE_FIXTURES")?.toKString() ?: error("SPIKE_FIXTURES is not set")
    return NSString.stringWithContentsOfFile("$dir/$name", NSUTF8StringEncoding, null) ?: error("cannot read $dir/$name")
}

/** `phys_footprint`, the number Xcode reports as the app's memory. */
@OptIn(kotlin.native.runtime.NativeRuntimeApi::class)
actual fun processMemoryBytes(): Long = memScoped {
    kotlin.native.runtime.GC.collect()
    val info = alloc<task_vm_info_data_t>()
    val count = alloc<mach_msg_type_number_tVar>()
    count.value = (sizeOf<task_vm_info_data_t>() / sizeOf<integer_tVar>()).toUInt()
    val result = task_info(mach_task_self_, TASK_VM_INFO.toUInt(), info.ptr.reinterpret(), count.ptr)
    if (result == KERN_SUCCESS) info.phys_footprint.toLong() else -1L
}

package dev.maleo.spike.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.TimeSource

/** A file written by `rust/build.sh` into `build/fixtures`. */
expect fun fixtureText(name: String): String

/** Platform process memory in bytes after a full garbage collection. */
expect fun processMemoryBytes(): Long

expect val platformName: String

private const val CALLS = 10_000
private const val WARMUP = 1_000

private fun report(line: String) = println("SPIKE[$platformName] $line")

/** FNV-1a over the UTF-8 bytes, to print one comparable digest per run. */
private fun digest(text: String): String {
    var hash = 0xcbf29ce484222325UL
    for (byte in text.encodeToByteArray()) {
        hash = (hash xor byte.toUByte().toULong()) * 0x100000001b3UL
    }
    return hash.toString(16)
}

class EngineSpikeTest {
    /** The same open, edit, read, undo, read, close run as `rust/src/bin/host.rs`. */
    @Test
    fun fixturesMatchTheHostRunByteForByte() {
        val results = buildString {
            for (line in fixtureText("fixtures.tsv").lineSequence().filter { it.isNotEmpty() }) {
                val (name, scope, command) = line.split('\t', limit = 3)
                val handle = Engine.open(scope)
                val inverse = Engine.execute(handle, command)
                val after = Engine.read(handle)
                Engine.execute(handle, inverse)
                val restored = Engine.read(handle)
                Engine.close(handle)
                append(name).append('\t').append(after).append('\t').append(inverse).append('\t').append(restored).append('\n')
            }
        }
        val host = fixtureText("host-results.tsv")
        val mismatch = host.lines().zip(results.lines()).indexOfFirst { (a, b) -> a != b }
        report("fixtures=${results.lines().count { it.isNotEmpty() }} bytes=${results.encodeToByteArray().size} digest=${digest(results)} host=${digest(host)} firstMismatchLine=$mismatch")
        assertEquals(host, results)
        assertEquals(0, Engine.openCount())
    }

    @Test
    fun oneEditRoundTripIsFastAndTenThousandCallsDoNotGrow() {
        val (scope, command) = fixtureText("bench.tsv").trimEnd('\n').split('\t', limit = 2)
        val handle = Engine.open(scope)
        var next = command
        repeat(WARMUP) { next = Engine.execute(handle, next) }

        val times = LongArray(CALLS)
        val liveBefore = Engine.liveBytes()
        val processBefore = processMemoryBytes()
        for (i in 0 until CALLS) {
            val mark = TimeSource.Monotonic.markNow()
            next = Engine.execute(handle, next)
            times[i] = mark.elapsedNow().inWholeNanoseconds
        }
        val liveGrowth = Engine.liveBytes() - liveBefore
        val processGrowth = processMemoryBytes() - processBefore
        Engine.close(handle)

        times.sort()
        fun ms(q: Double) = times[((times.size - 1) * q).toInt()] / 1_000_000.0
        report("calls=$CALLS p50=${ms(0.5)}ms p95=${ms(0.95)}ms max=${ms(1.0)}ms")
        report("scopeBytes=${scope.length} liveGrowth=$liveGrowth processGrowth=$processGrowth processBefore=$processBefore")
        assertTrue(ms(0.5) <= 1.0, "p50 round trip at most 1 ms")
        assertTrue(liveGrowth < scope.length, "Rust heap growth stays below the document size")
        assertEquals(0, Engine.openCount())
    }
}

plugins {
    kotlin("multiplatform") version "2.4.21"
    id("com.android.kotlin.multiplatform.library") version "9.4.1"
}

// Built by rust/build.sh before Gradle runs.
val rustTarget = layout.projectDirectory.dir("rust/target")
val fixtures = layout.buildDirectory.dir("fixtures")

kotlin {
    compilerOptions.freeCompilerArgs.add("-Xexpect-actual-classes")

    android {
        namespace = "dev.maleo.spike.core"
        compileSdk = 35
        minSdk = 24
        // Share commonTest with the device test, so both platforms run one harness.
        withDeviceTestBuilder { sourceSetTreeName = "test" }.configure {
            instrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        }
    }

    iosSimulatorArm64 {
        compilations.getByName("main").cinterops.create("engine") {
            definitionFile.set(file("src/nativeInterop/cinterop/engine.def"))
            includeDirs(file("src/nativeInterop/cinterop"))
            extraOpts("-libraryPath", rustTarget.dir("aarch64-apple-ios-sim/release").asFile.absolutePath)
        }
    }

    sourceSets {
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        getByName("androidDeviceTest") {
            resources.srcDir(fixtures)
            dependencies {
                implementation("androidx.test:runner:1.6.2")
                implementation("androidx.test.ext:junit:1.2.1")
                implementation("junit:junit:4.13.2")
            }
        }
    }
}

// The iOS test binary reads fixtures from the host file system; the simulator
// shares it. Pass the directory through the simulator child environment.
tasks.withType<org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeSimulatorTest>().configureEach {
    environment("SIMCTL_CHILD_SPIKE_FIXTURES", fixtures.get().asFile.absolutePath)
    device.set("iPhone 16 Pro")
}

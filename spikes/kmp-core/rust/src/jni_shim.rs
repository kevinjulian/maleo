//! The thin JNI shim for Android: each `external fun` of
//! `dev.maleo.spike.core.NativeEngine` crosses into the C ABI once. An engine
//! error becomes an `EngineException` carrying the engine's error JSON.

use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::{jint, jlong, jstring};

use crate::host;

const EXCEPTION: &str = "dev/maleo/spike/core/EngineException";

fn text(env: &mut JNIEnv, value: &JString) -> String {
    env.get_string(value).expect("a Java string").into()
}

fn finish(env: &mut JNIEnv, result: Result<String, String>) -> jstring {
    match result {
        Ok(out) => env.new_string(out).expect("a Java string").into_raw(),
        Err(error) => {
            env.throw_new(EXCEPTION, error).expect("throws");
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_open(mut env: JNIEnv, _: JClass, scope: JString) -> jint {
    let scope = text(&mut env, &scope);
    match host::open(&scope) {
        Ok(handle) => handle as jint,
        Err(error) => {
            env.throw_new(EXCEPTION, error).expect("throws");
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_execute(mut env: JNIEnv, _: JClass, handle: jint, command: JString) -> jstring {
    let command = text(&mut env, &command);
    let result = host::execute(handle as u32, &command);
    finish(&mut env, result)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_read(mut env: JNIEnv, _: JClass, handle: jint) -> jstring {
    let result = host::read(handle as u32);
    finish(&mut env, result)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_close(mut env: JNIEnv, _: JClass, handle: jint) -> jstring {
    let result = host::close(handle as u32);
    finish(&mut env, result)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_openCount(_: JNIEnv, _: JClass) -> jint {
    crate::engine_open_count() as jint
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_maleo_spike_core_NativeEngine_liveBytes(_: JNIEnv, _: JClass) -> jlong {
    crate::spike_live_bytes()
}

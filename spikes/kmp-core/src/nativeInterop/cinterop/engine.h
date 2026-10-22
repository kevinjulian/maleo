// The editor-wasm calling convention as a native C ABI (rust/src/lib.rs).
#include <stddef.h>
#include <stdint.h>

uint8_t *engine_alloc(size_t len);
const uint8_t *engine_output_ptr(void);
size_t engine_output_len(void);
uint32_t engine_open(uint8_t *ptr, size_t len);
uint32_t engine_execute(uint32_t handle, uint8_t *ptr, size_t len);
uint32_t engine_read(uint32_t handle);
uint32_t engine_close(uint32_t handle);
uint32_t engine_open_count(void);
int64_t spike_live_bytes(void);

# Environment Variables

The root `.env` is the only env file; there is no package-local one. The full
list of variables the repository reads, grouped by the service that reads them,
is the root [`.env.example`](../../../.env.example).

This page covers only the ones that change how `@maleo/api` itself behaves.

| Variable                      | Required   | Purpose                                                                                                              | Example                     |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `MALEO_API_PORT`              | No         | Port the API binds to.                                                                                               | `8090`                      |
| `MALEO_API_HOST`              | No         | Host the API binds to. Default `127.0.0.1` (loopback). Set to `0.0.0.0` only behind an authenticating reverse proxy. | `127.0.0.1`                 |
| `MALEO_DATA_DIR`              | No         | Root of all runtime data. Default `<repo>/data`.                                                                     | `/data`                     |
| `MALEO_DATABASE_URL`          | Production | Runtime Postgres connection. Development uses the embedded server under `MALEO_DATA_DIR`.                            | `postgres://…`              |
| `MALEO_GEN_WORKER_URL`        | No         | Media worker URL. Without it, image and speech generation report not configured.                                     | `http://localhost:7071`     |
| `MALEO_GEN_WORKER_PUBLIC_URL` | No         | Public worker origin used for persisted generated-file URLs.                                                         | `https://media.example.com` |
| `MALEO_SERVICE_TOKEN`         | Worker use | Matching API/worker service credential for processing and speech.                                                    | —                           |

## Caption execution

API reads `MALEO_GEN_WORKER_URL` and `MALEO_SERVICE_TOKEN`; it does not load a
Whisper binary or model. Settings setup/status and generated narration call the
execution host. Set these variables on **media worker**, not API alone:

| Variable                     | Default                     | Purpose                                                                                                              |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MALEO_WHISPER_CPP_DIR`      | `<repo>/data/whisper.cpp`   | Installed runtime and model files. Relative paths resolve from repository root.                                      |
| `MALEO_WHISPER_CPP_VERSION`  | `1.5.5`                     | Installed whisper.cpp runtime version.                                                                               |
| `MALEO_WHISPER_CPP_BIN`      | unset                       | Prebuilt whisper.cpp executable. When set, setup downloads only the model. The image sets it.                        |
| `MALEO_WHISPER_MODEL`        | `base`                      | Configured model; no automatic quality upgrade.                                                                      |
| `MALEO_CAPTION_CACHE_DIR`    | `<repo>/data/caption-cache` | Worker-owned audio/model/runtime/language/script cache.                                                              |
| `MALEO_CAPTION_TRANSCRIBE`   | disabled                    | `1` enables automatic generated-narration recognition. Explicit caption jobs remain available when runtime is ready. |
| `MALEO_WHISPER_AUTO_INSTALL` | disabled                    | `1` permits automatic runtime/model setup for narration.                                                             |

Production Compose mounts runtime/models/cache under `/data/media-worker`.
See [self-hosting](../../../docs/self-hosting.md) for installation and limits.

Large-v3-turbo word alignment requires a runtime with the `large.v3.turbo` DTW
preset; tested with 1.7.6. Runtime 1.5.5 rejects that preset. The small licensed
benchmark found mixed-language/noise errors, silence hallucinations with large
models, and word intervals extending into silent gaps. Review generated text and
timing; a larger model is not a guaranteed improvement. Defaults remain base/1.5.5.

## Notes

- Root `.env` belongs to local development; deployed processes receive service environment variables.
- Runtime database is Postgres. Worker result SQLite is a separate queue result store.
- Provider credentials can come from environment or encrypted operator settings; the configured media worker resolves them through the API seam.

# Risk B: external converter dependency blocker

17 October 2026. Status: DEPENDENCY BLOCKED. No real successful conversion verified.

## Actual execution path

`src/worker.ts` starts `ConversionWorkerRunner` from AppModule. `src/app.module.ts` binds `CONVERSION_ENGINE` to `ConversionEngineRouter`, which selects `CobolJavaConversionAdapter` or `BmsDspfConversionAdapter` using the persisted conversion type. The worker claims the exact execution generation with a processing token and lease. Ordinary engine exceptions become `CONVERSION_ENGINE_UNAVAILABLE` after allowed attempts; this code alone does not identify the underlying cause. The job's error message carries the adapter exception. Copybook blocking has its own code.

The checked-in `.env` and the existing backend/worker container configuration have `CONVERSION_WORKER_ENABLED=false` and no converter overrides. They were not changed or restarted. Owned isolated integration tests enable only their test worker. The previously observed retry failure was from an enabled isolated worker using the actual adapter, not evidence that the normal disabled worker is currently processing jobs.

## Missing dependencies

| Path | Exact expected artifact / configuration | Local finding |
| --- | --- | --- |
| COBOL to Java | `TOOL2JAVA_JAR_PATH`, otherwise `E:\ALSM\ALSM_TOOL\tool2java\target\akaBatch-1.0.jar`; adapter comment identifies `com.res.cobol.Main` | JAR and converter source/build descriptor absent |
| BMS to React | `TOOL_CONVERT_DIR`, otherwise `E:\ALSM\ALSM_TOOL\py\convert2fe`, containing `bms2react.py` | Directory and script absent |
| DSPF to React | Same tool directory, containing `dspf2react.py` and any local modules/assets | Script and converter source absent |

A hidden/ignored-inclusive inventory of the ALSM workspace, excluding Git internals, installed node_modules and GitNexus caches, examined 5,195 files and found no JAR, Java source, Maven POM, either script or converter-named source directory. This included existing original, emergency, demo and evidence directories and frozen paths read-only. Exact artifact-name history searches also found no converter implementation. The two documented default locations do not exist. No binaries were downloaded or executed.

The expected source is the project's separately maintained `ALSM_TOOL` distribution; a BMS adapter comment also names `Tool_Convert/py/convert2fe`. No verified repository URL, release checksum, license, build instruction or converter owner is supplied locally. The project owner/tool maintainer must provide that provenance and the matching complete source or release, rather than an arbitrary replacement JAR/script. A commercial license or external installation requirement cannot be determined from the backend adapter; license clearance and any redistribution/runtime rights remain unresolved.

Host `java` and `javac` report Temurin 21.0.12. This proves a host Java installation, not converter compatibility. Maven is on PATH but there is no converter POM. Host `python` resolves to a WindowsApps alias; a functioning Python runtime and converter dependencies have not been certified. The BMS adapter calls the tool stdlib-only, but this cannot be independently checked without its source. Required Java release, generated-code runtime JARs, Python version and ancillary packages must come from the actual tool release.

The Dockerfile's production stage contains the built Node application and production npm dependencies, without an explicit Java/Python/tool installation. Existing application containers have no mounts and no converter path overrides. Host runtime installations do not supply a container runtime. Do not enable or deploy a worker until its own environment has verified tools and accessible persisted source/result storage; the current Compose file does not declare shared application storage between API and worker.

## Process, output and review contract to validate after supply

- COBOL: `JAVA_EXECUTABLE` (default `java`), `-jar <JAR> -dld -odir <unique temp output + separator> -pp cobolprogramclasses -dp cobolprogramclasses -dp0 -fixed -c2 -overwrite <source directory>`. Preserve the existing package flags. The adapter searches the whole unique working directory for Java outputs, because the tool may ignore the output directory after its first class. Its current check is filename-based; nonempty structure, compilation and semantic success are not established by that check alone.
- BMS/DSPF: `PYTHON_EXECUTABLE` (default `python`), `bms2react.py -bms <source> -react <output>` and/or `dspf2react.py -dspf <source> -react <output>`, with the configured tool directory as CWD. It rejects unsuccessful/timed-out processes and requires a TSX component other than routes. No generated component fallback is permitted. The missing tool source prevents independent verification of script dependencies and output correctness.
- `runConversionTool` uses `spawn` with an argument array and captures stdout/stderr/exit/timeout. Default timeout is 120,000 ms. Each attempt has its own temp output directory. Artifacts are persisted through `StoragePort.writeFiles` under a unique result reference; only the token-owning worker may complete the persisted job.
- Result reads resolve authenticated organization and active project ownership. Quality review requires an authorized organization role, a COMPLETED job, accessible stored files and a persisted attributed decision. Existing HTTP success fixtures verify this plumbing only. Review persistence and audit append remain separate writes, as previously documented.
- The unused `unconfigured-conversion-engine.adapter.ts` still contains a legacy fabricated reference/version response. AppModule does not bind it, and this investigation did not activate it. It is not an available converter and must never be selected to bypass this blocker.

Supply the complete verified tool bundle and license/provenance first. Configure absolute worker-visible paths and a verified runtime. Run an owned disposable database/queue/storage environment with non-sensitive COBOL, BMS and DSPF sources; record exact executable/tool hashes, commands, stdout/stderr, exit status and output hashes. Independently parse/compile nonempty Java/TSX output using the actual generated-code dependencies, confirm persisted COMPLETED output and authorized review/reload, then test invalid source, no output, malformed/header-only output, nonzero exit, timeout and retries. Any integration fix found then should be a separate narrow commit. Do not replace missing engines with fixtures, AI output or synthetic success.

Implementation stopped at the missing artifact boundary as requested. Queue, worker, engine selection, runtime configuration and persisted results were not rewritten. Regression tests are not evidence of real successful conversion.

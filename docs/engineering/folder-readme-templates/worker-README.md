# Worker Runtime

The Worker is the background runtime for BullMQ processing.

## Responsibilities

- consume conversion job IDs;
- load persistent job state;
- mark processing state;
- select the correct conversion strategy;
- invoke `ConversionEnginePort`;
- persist result/error state;
- respect retry/dead-job rules.

## Non-responsibilities

- HTTP API serving;
- authentication UI flows;
- implementing BMS/DSPF/COBOL conversion algorithms directly.

## Configuration

Document queue names, Redis config, `CONVERSION_WORKER_ENABLED`, local run command, and Docker run command here.

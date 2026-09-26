# cobol-java-semantic-v1

- Dataset ID: `cobol-java-semantic-v1`
- Version: `1.0.0`
- Type: synthetic curated evaluation set
- Total: 40 cases
- Clean controls: 10
- Mutated cases: 30
- Difficulty: 12 EASY, 18 MEDIUM, 10 HARD

Each supported category has exactly three mutations:

| Category | Cases |
| --- | ---: |
| DATA_TYPE_MISMATCH | 3 |
| VARIABLE_MAPPING_MISMATCH | 3 |
| LOGIC_MISMATCH | 3 |
| CONTROL_FLOW_MISMATCH | 3 |
| FILE_IO_MISMATCH | 3 |
| DATABASE_MISMATCH | 3 |
| ENCODING_MISMATCH | 3 |
| MISSING_OPERATION | 3 |
| UNSUPPORTED_CONSTRUCT | 3 |
| POTENTIAL_BEHAVIOR_CHANGE | 3 |

The mutation operators are: decimal-to-integer, signed-to-absolute, 64-bit narrowing, three distinct
field swaps/mismaps, reversed condition, inclusive-to-exclusive, arithmetic replacement, omitted
else, loop termination change, inserted early return, omitted file write, append-to-overwrite, final
record drop, omitted database update, database key replacement, omitted commit, character-set
replacement, packed-decimal text decoding, fixed-width trimming, omitted tax/audit/initialization,
ignored GO TO/REDEFINES, fixed OCCURS DEPENDING ON, changed rounding, blank-to-null, and changed
timezone semantics. Every operator occurs once; fixtures are not duplicated with trivial renaming.

All examples and identifiers are fictional and were created for ALSM Phase 6. The manifest contains
no customer or production code, credentials, real personal data, or real database details. See the
parent evaluation README for labeling review and scientific limitations.

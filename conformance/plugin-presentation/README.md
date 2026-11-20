# Plugin presentation fixtures

`cases.json` is a starter set of nine language-neutral input/output cases for the Plugin Presentation Profile. Each case supplies an execution schema and display descriptor. Successful cases supply a payload and an expected partial presentation; invalid cases name the required diagnostic code. `omitsSummary` requires omission of the interpolated summary. It is not yet a complete profile conformance suite.

The SDK test `plugin-presentation-conformance.test.ts` reads this file directly. It also tests numeric rejection and resource boundaries without putting already-rounded JSON numbers in the fixture file. Native clients can use these same cases; their UI still owns application context, artifact trust, pinning, retention, and the decision to sign.

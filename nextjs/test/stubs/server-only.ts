// Stub for the `server-only` package under Vitest.
//
// `server-only`'s real `index.js` unconditionally throws on import — it only
// behaves as a no-op marker inside Next.js's own bundler, which replaces it
// for server bundles and turns it into a real error only for client bundles.
// Plain Node/Vitest has no such replacement, so importing the real package
// here would make every test that pulls in a `server/**` module fail with
// "This module cannot be imported from a Client Component module", even
// though nothing here is a Client Component. Both vitest.config.ts and
// vitest.unit.config.ts alias `server-only` to this empty module instead.
export {}

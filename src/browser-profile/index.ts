// Unified browser-profile barrel.
//
// PR33 (Bucket G.5): the previously separate peer-level modules
// (`browser-profile`, `browser-profile-persistence`, `browser-profile-recovery`,
// `browser-profile-save`, `browser-profile-store`, `browser-runtime-session`,
// `browser-session-orchestration`) were consolidated verbatim into this single
// directory as sub-modules. This is a move/reorganize only — no flow logic was
// rewritten and no public name was added or removed. Each sub-barrel below maps
// to one of the former peer modules.
export * from './core';
export * from './persistence';
export * from './recovery';
export * from './save';
export * from './store';
export * from './session-orchestration';
export * from './runtime-session';

// ports/core/index.mjs — 统一出口
export * from './engine.mjs';
export { LAYOUTS, MARKERS, DEFAULT_LAYOUT, detectLayout, findRoot, layerDirs } from './fsutil.mjs';
export { buildIndexForScope, searchChunks, tokenize } from './search.mjs';

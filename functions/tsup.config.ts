import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  outDir: 'lib',
  clean: true,
  sourcemap: true,
  // Workspace packages are bundled in; npm deps stay external (installed by Firebase on deploy).
  noExternal: [/^@texafashions\//],
});

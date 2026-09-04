import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    // Default to node; component tests annotate with @vitest-environment jsdom
    environment: 'node',
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
    server: {
      port: 5173,
      host: '127.0.0.1',
      hmr: {
        timeout: 120000,
        overlay: false,
      },
      proxy: {
        '/api':        { target: 'http://localhost:5000', changeOrigin: true },
        '/uploads':    { target: 'http://localhost:5000', changeOrigin: true },
        '/gallery':    { target: 'http://localhost:5000', changeOrigin: true },
        '/admin':      { target: 'http://localhost:5000', changeOrigin: true },
        '/models':     { target: 'http://localhost:5000', changeOrigin: true },
        '/static':     { target: 'http://localhost:5000', changeOrigin: true },
      },
    },
    build: {
      cssCodeSplit: true,
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'router': ['react-router-dom'],
            'ui-vendor': ['@react-spring/web', 'lucide-react', 'sonner'],
            'radix-vendor': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-label',
              '@radix-ui/react-separator',
              '@radix-ui/react-slot',
              '@radix-ui/react-toggle',
              '@radix-ui/react-tooltip',
            ],
            'form-vendor': ['class-variance-authority', 'clsx', 'tailwind-merge'],
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
      },
    },
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

// Helper function to recursively copy a directory
function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  for (const file of readdirSync(src)) {
    const srcPath = join(src, file)
    const destPath = join(dest, file)
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

// Clean the target directory (optional)
function cleanDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Everything ships in one `index` chunk except the process-flow view (React
// Flow + ELK), which loads when its tab opens.
const PROCESS_FLOW = /node_modules\/(@xyflow|elkjs|html-to-image|zustand|classcat)\/|src\/web_view\/(process_flow|flowsheet_graph)\./

// https://vite.dev/config/
// `vite build --mode browser` emits standalone assets for the browser host
// (served by fi-serve) into dist-browser/ and leaves the extension copy alone.
// Relative asset paths let the lazy chunk resolve next to the main one in both
// hosts (the extension rewrites ./assets/ in index.html to webview URIs).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    mode !== 'browser' && {
      name: 'copy-to-extension',
      apply: 'build',
      closeBundle() {
        const src = './dist'
        const dest = '../extension/src/webview_template/webview_new'

        // Clean target directory to ensure no old files remain
        cleanDir(dest)

        // Copy build artifacts
        copyDir(src, dest)
        console.log('✅ Copied build to extension/src/webview_template/')
      }
    }
  ],
  build: {
    ...(mode === 'browser' && { outDir: 'dist-browser' }),
    rollupOptions: {
      output: {
        manualChunks: (id) => (PROCESS_FLOW.test(id) ? 'process_flow' : 'index'),
      }
    }
  }
}))

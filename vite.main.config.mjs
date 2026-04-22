import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    {
      name: 'copy-tray-icons',
      closeBundle() {
        const srcDir = resolve(process.cwd(), 'src');
        const outDir = resolve(process.cwd(), '.vite/build');
        mkdirSync(outDir, { recursive: true });
        const files = [
          'iconTemplate.png',
          'iconTemplate@2x.png',
          'iconTemplatePaused.png',
          'iconTemplatePaused@2x.png',
        ];
        for (const file of files) {
          copyFileSync(resolve(srcDir, file), resolve(outDir, file));
        }
      },
    },
  ],
});

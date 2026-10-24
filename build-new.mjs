// Builds the redesigned frontend so it can be served at /new by the production app.
// API calls, voice samples and avatars use absolute paths, so they hit the main site's backend.
import { build } from 'vite';

await build({
  root: 'G:/sawtik-ai-tts-studio-redesign',
  base: '/new/',
  publicDir: false, // avatars/samples are already served by the main app
  logLevel: 'warn',
  build: {
    outDir: 'G:/sawtik-ai-tts-studio-wizard/public/new',
    emptyOutDir: true,
  },
});
console.log('built into wizard/public/new');

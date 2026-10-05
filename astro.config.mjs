// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Served as a GitHub Pages project site under the user's custom domain.
export default defineConfig({
  site: 'https://shubhamtatvamasi.com',
  base: '/ibkr',
  trailingSlash: 'ignore',
  integrations: [svelte()],
});

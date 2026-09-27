import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: { usePolling: true },
    proxy: { '/api': 'http://api:8000' },
  },
  plugins: [{
    name: 'private-server-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '/').split('?')[0]);
        if (/^\/(server|\.git|\.base44)(\/|$)/.test(path) || /\.(py|sqlite3|yml|md)$/.test(path)) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        next();
      });
    },
  }],
});

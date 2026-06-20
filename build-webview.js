const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function build() {
  try {
    const ctx = await esbuild.context({
      entryPoints: [path.join(__dirname, 'src', 'webview', 'index.tsx')],
      bundle: true,
      outfile: path.join(__dirname, 'out', 'webview.js'),
      format: 'iife',
      globalName: 'WebviewApp',
      loader: { '.css': 'css' },
      define: { 'process.env.NODE_ENV': '"production"' },
      minify: false,
      sourcemap: true,
      logLevel: 'info',
    });

    if (isWatch) {
      await ctx.watch();
      console.log('👀 Watching webview...');
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log('✅ Webview bundled: out/webview.js');
    }
  } catch (err) {
    console.error('❌ Webview build failed:', err.message);
    process.exit(1);
  }
}

build();

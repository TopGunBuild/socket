(async () => {
    const esbuild = require('esbuild');
    const fs = require('fs');
    const metafile = false;

    let result = await esbuild.build({
        globalName: 'topGunSocketClient',
        entryPoints: ['src/socket-client/index.ts'],
        outfile: 'dist/browser/client.js',
        bundle: true,
        sourcemap: true,
        minify: true,
        format: 'iife',
        target: ['esnext'],
        metafile
    });

    if (metafile) {
        let text = await esbuild.analyzeMetafile(result.metafile);
        fs.writeFileSync('dist/client.meta.json', JSON.stringify(result.metafile));
        console.log(text);
    }
})();

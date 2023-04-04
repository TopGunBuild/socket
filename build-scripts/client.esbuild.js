(async () => {
    const esbuild = require('esbuild');
    const fs = require('fs');
    const metafile = false;

    // iife
    let result = await esbuild.build({
        globalName: 'topGunSocketClient',
        entryPoints: ['src/socket-client/index.ts'],
        outfile: 'dist/socket-client.js',
        bundle: true,
        sourcemap: true,
        minify: true,
        format: 'iife',
        target: ['esnext'],
        metafile
    });

    // esm
    await esbuild.build({
        globalName: 'topGunSocketClient',
        entryPoints: ['src/socket-client/index.ts'],
        outfile: 'dist/socket-client.module.js',
        bundle: true,
        sourcemap: true,
        minify: true,
        format: 'esm',
        target: ['esnext'],
    });

    if (metafile) {
        let text = await esbuild.analyzeMetafile(result.metafile);
        fs.writeFileSync('dist/client.meta.json', JSON.stringify(result.metafile));
        console.log(text);
    }
})();

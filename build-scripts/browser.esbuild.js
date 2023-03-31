(async () => {
    const esbuild = require('esbuild');
    const fs = require('fs');
    const metafile = false;

    let result = await esbuild.build({
        globalName: 'topGunSocketClient',
        entryPoints: ['src/socket-client/ws-browser.ts'],
        outfile: 'dist/ws-browser.js',
        bundle: true,
        sourcemap: true,
        minify: true,
        target: ['esnext'],
        metafile
    });

    if (metafile) {
        let text = await esbuild.analyzeMetafile(result.metafile);
        fs.writeFileSync('dist/ws-browser.meta.json', JSON.stringify(result.metafile));
        console.log(text);
    }
})();

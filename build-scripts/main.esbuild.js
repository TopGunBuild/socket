(async () => {
    const esbuild = require('esbuild');
    const fs = require('fs');
    const metafile = false;

    let result = await esbuild.build({
        entryPoints: ['src/index.ts'],
        outfile: 'dist/index.js',
        bundle: true,
        sourcemap: true,
        minify: true,
        target: ['esnext'],
        metafile
    });

    if (metafile) {
        let text = await esbuild.analyzeMetafile(result.metafile);
        fs.writeFileSync('dist/main.meta.json', JSON.stringify(result.metafile));
        console.log(text);
    }
})();

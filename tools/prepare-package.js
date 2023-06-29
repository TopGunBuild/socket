const fs = require('fs');
const path = require('path');

const PACKAGE_DIRS = [
    'auth',
    'channel',
    'client',
    'errors',
    'formatter',
    'response',
    'server',
    'simple-broker',
    'types'
];

const getContent = function (name)
{
    return `{
    "name": "topgun-socket/${name}",
    "typings": "../dist/${name}.d.ts",
    "main": "../dist/${name}.js",
    "module": "../dist/${name}.mjs",
    "sideEffects": false
}`;
};

for (const dir of PACKAGE_DIRS)
{
    if (!fs.existsSync(dir))
    {
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(__dirname, '..', dir, 'package.json'), getContent(dir));
    }
}

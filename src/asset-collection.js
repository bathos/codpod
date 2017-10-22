const crypto  = require('crypto');
const fs      = require('fs');
const zlib    = require('zlib');
const { URL } = require('url');

const exCSS  = require('./css/extract-css-specifiers.js');
const exES   = require('./ecmascript/extract-es-specifiers.js');
const exHTML = require('./html/extract-html-specifiers.js');
const handle = require('./asset-handler.js');

const CONTENT_TYPES = new Map([
  [ 'css',  'text/css'                    ],
  [ 'gif',  'image/gif'                   ],
  [ 'html', 'text/html; charset=utf-8'    ],
  [ 'ico',  'image/vnd.microsoft.icon'    ],
  [ 'jpg',  'image/jpeg'                  ],
  [ 'js',   'text/javascript'             ],
  [ 'md',   'text/markdown; charset=utf8' ],
  [ 'png',  'image/png'                   ],
  [ 'webp', 'image/webp'                  ]
]);

const collectAssets = (dirPath, toLocalPath, staticDirPath=dirPath) => fs
  .readdirSync(dirPath)
  .filter(childPath => !childPath.startsWith('.'))
  .map(childPath => path.join(dirPath, childPath))
  .reduce((acc, childPath) => acc.concat(fs.statSync(childPath).isDirectory()
    ? collectAssets(childPath, toLocalPath, staticDirPath)
    : resolveAsset(childPath, toLocalPath, staticDirPath)
  ), []);

const createEtag = buf =>
  `"${ crypto.createHash('sha1').update(buf).digest('base64') }"`;

const extractDeps = (ext, buf) => {
  switch (ext) {
    case 'css'  : return Array.from(exCSS(buf));
    case 'js'   : return Array.from(exES(buf), ([ specifier ]) => specifier);
    case 'html' : return Array.from(exHTML(buf), ([ specifier ]) => specifier);
    default     : return [];
  }
};

const flattenDeps = (asset, seen=new Set()) => {
  if (seen.has(asset)) return;

  seen.add(asset);

  asset.deps.forEach(dep => flattenDeps(dep, seen));

  asset.deps = new Set(asset.deps
    .map(dep => [ dep, ...dep.deps ])
    .reduce((acc, deps) => acc.concat(deps), [])
  );

  asset.deps.delete(asset);

  asset.deps = Array.from(asset.deps);
};

const resolveAsset = (filePath, toLocalPath, staticDirPath) => {
  const buf  = fs.readFileSync(filePath);
  const ext  = filePath.slice(filePath.lastIndexOf('.') + 1);
  const path = filePath.slice(staticDirPath.length);

  return {
    buf,
    path,
    body: zlib.deflateSync(buf),
    deps: extractDeps(ext, buf).map(toLocalPath(path)).filter(Boolean),
    etag: createEtag(buf),
    type: CONTENT_TYPES.get(ext) || 'application/octet-stream'
  };
};

const toLocalPath = hostname => {
  const httpsOrigin   = `https://${ hostname }/`;

  return parentPath => childPath => {
    const contextURL = new URL(parentPath, httpsOrigin);
    const url        = new URL(childPath, contextURL);

    if (url.origin !== contextURL.origin) return;

    return url.pathname;
  };
};

module.exports = class AssetCollection {
  constructor({ path: staticDirPath, fallback, handle404, hostname }) {
    this.cacheControl     = `public, max-age=${ 2 * 24 * 60 * 60 }`;
    this.contentEncoding  = 'deflate';
    this.origin           = `https://${ hostname }/`;
    this.handle           = handle.bind(this);
    this.handle404        = handle404;
    this.lastModifiedDate = new Date();
    this.lastModified     = this.lastModifiedDate.toUTCString();

    const assets = collectAssets(staticDirPath, toLocalPath(hostname));

    this.assets = new Map(assets.map(asset => [ asset.path, asset ]));

    for (const asset of assets) {
      for (const [ index, specifier ] of asset.deps.entries()) {
        asset.deps[index] = this.assets.get(specifier);
      }

      asset.deps = asset.deps.filter(Boolean);
    }

    flattenDeps({ deps: assets });

    if (fallback) {
      this.fallbackAsset = this.assets.get(fallback);
    }
  }

  renderDeps() {
    return Array.from(this.assets, ([ path, { deps } ]) =>
      `${ path }${ deps.map(dep => `\n  => ${ dep.path }`).join('') }`
    ).join('\n');
  }
}

const { URL } = require('url');

const {
  canAccept,
  conditionUnchanged,
  conditionsUnsatisfied
} = require('./asset-handler-utils');

// This isn’t flexible at all, but it does try to be a little robust within its
// tiny window, anyway. Consider this a stub for something more serious that I’d
// like to do in the future, after experimenting more and seeing what patterns
// emerge surrounding native node HTTP2.
//
// There is no content negotiation, except that we simply serve our one type and
// one encoding if the agent will accept it, or else we send an appropriate
// status to indicate we couldn’t fulfill the requirements.
//
// Right now there’s also nothing clever about 'last modified' dates in
// AssetCollection. The last modified date will always just be the time that the
// instance was created. In practice, this is probably quite sufficient; real
// browsers will prefer the strong etags for conditional requests, anyway, and
// we’re not fetching the resources from disk dynamically.
//
// A note about paths: there is some inconsistency in how some libs handle paths
// that stuck me as sorta off. The WHATWG URL API, as implemented in Chrome
// today, handles it perfectly, exactly how I would expect:
//
// - non-reserved percent-encoded chars are decoded automatically
// - bad percent sequences do not throw errors; are instead treated as literal
// - *reserved* percent-encoded chars are not decoded automatically
// - resolves dots safely (against the hostname — not your filesystem)
//
// The URL spec does state that the paths /%41/ and /A/ have the same identity,
// while the paths /%2F/ and /// do not — there’s no obligation to treat them
// the same, and I’d rather not.
//
// Unfortunately, the implementation of URL in node is not the same as in the
// latest Chrome. Node does not return /A/ for /%41/ like URL in Chrome does, so
// we would have to use decodeURI (not decodeURIComponent) on the pathname to
// get the right-ish behavior, except that this will throw for bad percent
// sequences... well, for now, I’m just pretending that node’s URL has Chrome’s
// behavior since I imagine it’s just a matter of waiting for Node to catch up
// to the latest V8.
//
// As for dots, although it’s nice that URL does that, we never look at the
// local filesystem in response to an external request, anyway. The assets are
// gathered / known in advance.

const { handle } = {
  async handle(req, res) {
    const url    = new URL(req.url, this.origin);
    const status = this.assets.has(url.pathname) ? 200 : 404;

    if (status === 404 && this.handle404 && await this.handle404(req, res)) {
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(status, { allow: 'GET, HEAD, OPTIONS' });
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD, OPTIONS' });
      res.end();
      return;
    }

    const asset          = this.assets.get(url.pathname) || this.fallbackAsset;
    const accept         = (req.headers['accept'] || '').toLowerCase();
    const acceptEncoding = (req.headers['accept-encoding'] || '').toLowerCase();

    if (!canAccept(accept, asset.type)) {
      res.writeHead(406);
      res.end();
      return;
    }

    if (
      !acceptEncoding.startsWith('*') &&
      !acceptEncoding.includes(this.contentEncoding) // lazy, should parse
    ) {
      res.writeHead(406);
      res.end();
      return;
    }

    if (conditionsUnsatisfied(req.headers, asset, this.lastModifiedDate)) {
      res.writeHead(412);
      res.end();
      return;
    }

    if (conditionUnchanged(req.headers, asset, this.lastModifiedDate)) {
      res.writeHead(304);
      res.end();
      return;
    }

    const headers = {
      'cache-control'    : this.cacheControl,
      'content-encoding' : this.contentEncoding,
      'content-length'   : asset.body.length,
      'content-type'     : asset.type,
      'etag'             : asset.etag,
      'last-modified'    : this.lastModified
    };

    if (req.method === 'HEAD') {
      res.writeHead(status, headers);
      res.end();
    } else if (asset.deps.length && res.stream && res.stream.pushAllowed) {

      // This is the http2 meat. The documentation is still very raw and
      // incomplete, which makes sense given that this is a flagged feature.
      // Even in the tests it didn’t seem there were any substantial examples of
      // using the compatibility API yet, so it took a while to figure out what
      // this needed to look like, and I’m not sure if maybe there are better
      // ways to do stuff.

      headers[':status'] = status;

      res.stream.respond(headers);

      for (const dep of asset.deps) {
        res.stream.pushStream({
          ':method' : 'GET',
          ':path'   : dep.path
        }, stream => {
          stream.respond({
            ':status'          : 200,
            'cache-control'    : this.cacheControl,
            'content-encoding' : this.contentEncoding,
            'content-length'   : dep.body.length,
            'content-type'     : dep.type,
            'etag'             : dep.etag,
            'last-modified'    : this.lastModified
          });

          stream.end(dep.body);
        });
      }

      res.stream.end(asset.body);
    } else {
      res.writeHead(status, headers);
      res.end(asset.body);
    }
  }
};

module.exports = handle;

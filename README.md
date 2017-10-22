# Codpod

> This is an experimental thing, and I have not yet written tests or figured
> out where I might head with it.

This is a set of tools for extracting resource URIs / module specifiers from
CSS files, HTML documents or fragments, and EcmaScript modules. The intended use
case is the derivation of dependency graphs for use when serving resources with
HTTP2 push promises, but it could be useful for other things, too.

It extracts specifiers without producing an AST; it does parse, technically, but
for minimized, superset grammars that conflate tokens and structures as far as
is possible while retaining correct behavior for _valid_ input. The trade-off
for this efficiency is that it will also accept invalid input. For HTML and CSS,
which permit recovery in all scenarios anyway, this is not strange; however it
is strange for ES, where a syntactically invalid module would normally not
parse.

> Initially when I began exploring serving native ES modules and using HTTP2
> push promises, I used rollup to resolve ES dependency graphs. Rollup is a
> fantastic tool, but it was not quite what I wanted — I wasn’t generating
> bundles or doing transformations, and I needed to extract specifiers from
> non-ES resources as well. For my use case, I wanted something light, targeted
> to the specific problem, and fast enough to run synchronously as part of
> server bootstrapping without feeling too naughty.

Perhaps this will be useful to others as well. The three extractor functions are
the part of the API I would expect to be of interest, mainly. There is also
another function exported that synchronously builds a static HTTP2 server
request handler when given an absolute path to an asset directory. It is not
very configurable and to use it you would need to (at the moment) start node
with the `--expose-http2` flag. Since it is limited/opinionated, and because
native node http2 isn’t public API yet, it is more likely to be useful as a
demonstration / reference for ideas.

<!-- MarkdownTOC -->

- [Usage](#usage)
  - [Extractors](#extractors)
- [Behavior for each language](#behavior-for-each-language)
  - [CSS](#css)
  - [HTML](#html)
  - [EcmaScript](#ecmascript)
- [Notes on the implementation](#notes-on-the-implementation)
- [Static HTTP2 server](#static-http2-server)

<!-- /MarkdownTOC -->

## Usage

### Extractors

Codpod exports three functions that accept a buffer and return an iterator.
These are synchronous (beyond, of course, the fact that `.next()` can be
deferred), which — well, normally I’d have written these as streams, so that a
file can be piped in, but in practice there were a few reasons this didn’t make
sense for my use case; because this was part of (a) app bootstrap and (b) I
needed to have the whole file contents on hand anyway, streaming represented
unnecessary overhead. In any case they accept utf8 buffers, not strings or
streams.

```
import {
  extractSpecifiersFromCSS,
  extractSpecifiersFromES,
  extractSpecifiersFromHTML
} from 'codpod';

for (const url of extractSpecifiersFromCSS(cssBuf)) {
  // url is a string
}

for (const [ specifier, type ] of extractSpecifiersFromES(esBuf)) {
  // specifier is a string
  // type is 'import' (which includes 'export ... from') or 'fetch'
}

for (const [ url, key ] of extractSpecifiersFromHTML(htmlBuf, keyOverride)) {
  // url is a string
  // key is 'href', 'src', 'srcdoc', or 'xlink:href'
}
```

Note that for HTML you can override the set of attribute keys to extract, but it
does not permit constraining by element name. Custom keys should be lowercase.

## Behavior for each language

### CSS

#### What gets extracted

For CSS, codpod will extract the string values of all URL tokens, plus the
string values of strings seen in @import at rules.

#### Notes on parsing

This is the simplest case, since it is entirely realizable through lexing. Aside
from @import, which can have a url without an actual url token, it does not care
where such tokens appear. If the CSS is well-formed, this simply doesn’t matter.
URL tokens themselves must be valid or will not be included in the results.

### HTML

#### What gets extracted

For HTML, codpod will extract the string values of element attributes whose keys
are one of:

- `href`
- `src`
- `srcdoc`
- `xlink:href`

The values will be trimmed. It does not care what elements these attributes
appear on. The absence of `srcset` is deliberate, because by definition the
decision about which url in the srcset should be sent belongs to the client.

The set of keys is also customizable, however.

#### Notes on parsing

For HTML, I’ve made two concessions for implementation simplicity which are
technically divergent; since the stated premise here is normally that valid
input is always handled correctly, these two exceptions, though unlikely to have
consequences normally, should be documented:

1. In HTML, unlike XML, the semicolon terminating a character reference is not
   required (well, maybe it is — but the behavior for when it isn’t present is
   well-defined, so it kinda isn’t). When encountering one of these
   semicolon-free character references in an attribute value, if the very next
   character is either "=" or alphanumeric, there is some special (and
   mysterious!) legacy behavior prescribed which I have not implemented.

2. HTML, for the most part, does not recognize the CDATA section construct from
   XML according to XML’s semantics — instead, it would typically be parsed as
   a "bogus comment". However, there are a few exceptions where it does have the
   semantics of XML (i.e., where ">" will not close it, only "]]>"). The trouble
   is, these exceptions require knowledge of the element context as well as
   awareness of all the elements in HTML and their content behaviors — and this
   is the _only_ such case, for our purposes, which would require that. Handling
   this case in the technically correct way would balloon the complexity of
   specifier extraction in HTML dramatically, and I did not feel it was
   justified (even unhandled, it is unlikely to cause misbehavior).

### EcmaScript

#### What gets extracted

For EcmaScript, only modules are intended to be supported. Specifiers will be
extracted from import statements, and will also be extracted from export
statements if they have a 'from' clause.

In addition, codpod will extract specifiers from `fetch('specifier', ...)` calls
that meet certain criteria. It must be a `CallMemberExpression` where the first
item is the identifier `fetch` — i.e., it cannot be `window.fetch(...` etc — and
it must occur at module scope, not within a function or block, and the first
argument must be a string literal or a template with no substitutions.

#### Why fetch?

For my purposes, detecting fetch calls was important; this is necessary for
bringing in non-ES dependencies, as `import` cannot. In "loader" systems like
Webpack, import specifiers are used as hooks that may generate ES modules from
non-ES files using plugins. This is perfectly valid, but if I can avoid tightly
coupling my applications to specific build tools, I consider that preferable. I
use codpod to build my dependency graph, but at least in my case, all the
resources being pointed at are real files that can be used as-is. Therefore if I
want an HTML template, I fetch it, I do not import it.

By restricting detection to module scope, we can avoid picking up fetch calls
that are actually conditional or deferred, since such resources aren’t suitable
for pushing early. However, this is an imperfect proxy — "module scope" does not
mean "unconditional", and "not module scope" does not mean "conditional". For
example, these all aligns nicely:

```
fetch('foo', ...); // module scope, unconditional, extracted

const bar = {
  foo: fetch('foo', ...) // module scope, unconditional, extracted
};

if (something()) {
  const foo = fetch('foo', ...); // block scope, conditional, not extracted
}
```

But these do not:

```
something() && fetch('foo', ...); // module scope, conditional, still extracted

{
  fetch('foo', ...); // block scope, unconditional, still not extracted
}
```

#### Why not dynamic import?

Specifiers in dynamic import expressions, even if provided as string literals,
are not extracted because, by definition, such resources should not be pushed.
If the dynamic import takes place unconditionally at module scope, then it
clearly should have been a static import.

#### Notes on parsing

The sort of twilight-zone, superset parsing used in codpod is considerably more
complex for ES than it is for HTML and CSS, since more state must be tracked to
make correct deductions. Nonetheless it is still mostly just lexing; the state
needed to deduce the above turned out surprisingly small, despite being rather
complicated to figure out!

Although I stated that only modules are intended to be supported, this is a
technicality — in practice, for a script to be read incorrectly, it would need
to rely on ASI and include rather contrived, unlikely token sequences involving
the use of `let`, `await`, or `yield` as binding identifiers (which is illegal
in modules).

Also worth noting is that unlike `import` and `export` statements, static
analysis cannot truly detect things like fetch calls. Codpod assumes that if
`fetch` is used at module scope, it is a reference to the `fetch` function which
is the WHATWG API exposed in browsers.

## Notes on the implementation

There are two approaches I’ve seen to doing things like this before:

1. Fully parse input, generating a complete AST, just as one would for tasks
   like transformation, validation, or evaluation.
2. Use hacky regexes (maybe with some extra processing logic).

We could consider these two extremes on a spectrum. The first is precise, but
relatively slow and expensive, while the second is fast but imprecise, may
behave strangely for malformed input, and rather importantly, is also pretty
likely to fail for well-formed input.

I thought that it might be possible to find a balance by writing a tool
specifically focused on this one problem. Generic parsing means creating an AST
that can satisfy the needs of all or most consumers, but it’s overkill for such
a narrow concern. First, let’s state the goals explicitly:

- Given CSS, I want to get a list of the values of its URL tokens.
- Given HTML, I want to get a list of the values of "src" and "href" attributes.
- Given ES, I want to get a list of specifiers from import/export and certain
  'fetch' calls.

Starting from "full generic parsing", we can remove features that aren’t needed
to solve these problems one by one until any further removal would compromise
accuracy _for these needs_. The most obvious item is that none of these problems
require a consumable AST representation. The AST often serves double duty,
helping the parser understand its own state as it makes decisions — so we will
still need to represent state internally while processing, but it will not need
anywhere near the same level of detail or to be persistent.

The next thing we can do is a bit sneaky, but makes all the difference in the
world. We can write a parser for a _different language_ — an imaginary language
which is a superset of the target language. The best analogy I can think of
(which is still not a very good one) is the difference between a very realistic
painting and one that is made of simple shapes. If your only objective is to
depict a human face, you can remove a lot of detail without actually
compromising on meeting that objective. The chief observable consequence: such a
parser will be guaranteed to produce the same result as a generic and "complete"
parser _only when given valid input;_ it will permit input that other parsers
would consider illegal.

A basic example will help to illustrate what I’ve described so far — let’s look
at string tokens in ES. Normally, the lexical grammar of a string token needs to
account for a variety of types of escape sequences, each with their own rules,
as well as the possibility of a line terminator or premature end of input, which
would be illegal. We would normally interpret and validate the escapes and
generate a "cooked" string value for the AST as well. But in our imaginary
language, the grammar for a double quoted string is a good deal simpler:

    DoubleQuotedString:
      | '"' EOF
      | '""'
      | '"' DoubleQuoteChars EOF
      | '"' DoubleQuoteChars '"'
      ;

    DoubleQuoteChar:
      | '\' ANY_CHAR
      | ANY_CHAR_BUT_BACKSLASH_OR_DOUBLE_QUOTE
      ;

    DoubleQuoteChars:
      | DoubleQuoteChar
      | DoubleQuoteChar DoubleQuoteChars
      ;

Given a valid ES module containing double quoted strings, this superset
production will match all those double quoted strings with far less logic, and
it won’t produce false-positives for any other tokens. The trade off, though, is
that it would also match on input that would normally be _invalid_, for example
a string like `"\u1"`.

We can take these reductions much further. Tokens that are distinct in the real
grammar can be conflated with one another anywhere that, from the perspective of
our goal, they have become indistinguishable. As we continue reducing the
grammar, the language described expands, thus number of normally invalid inputs
that would be accepted increases — yet the accuracy when given valid input does
not change (unless I’ve made mistakes, of course!). The parsing logic ultimately
becomes a bit foreign looking for its abstract simplicity. For example, with the
ES specifier extractor, there is literally no acknowledgement of numeric tokens
as a distinct lexical construct, since they have been completely absorbed by
other handling. At the "parsing" level, state representation also ends up
extremely minimal — instead building an AST, for ES we end up with:

- a FILO stack of symbols representing nested groupings;
- four boolean flags that get toggled as we proceed, like railroad switches;
- an integer property that is used when discovering positions where a "/" that
  follows ")" begins a regular expression rather than a division operator.

For HTML and CSS, even this state (the tiny vestige of "parsing") dissolves away
and we’re left with almost entirely lexical concerns. In fact, for those two, we
don’t even need to bother decoding UTF-8 — we can operate on the raw byte
stream!

## Static HTTP2 server

As mentioned earlier, there is a simple HTTP2 asset server compatibility API
request-handler function that you can play with if you use the `--expose-http2`
node flag and pass it to `http2.createSecureServer(opts, handler)` or similar,
but it is not configurable enough to be of use to others as anything but a
proof-of-concept thingie. When the native http2 module becomes formally part of
node’s standard lib, I may revisit this to make it more generic.

```
import fs from 'fs';
import http2 from 'http2';
import path from 'path';
import { AssetCollection } from 'codpod';

const ASSETS_PATH        = path.resolve(__dirname, '../my-assets/');
const HOSTNAME           = 'foo.com';
const SSL_CHAIN_PATH     = '...';
const SSL_FULLCHAIN_PATH = '...';
const SSL_KEY_PATH       = '...';

http2.createSecureServer({
  allowHTTP1 : true,
  ca         : fs.readFileSync(SSL_CHAIN_PATH),
  cert       : fs.readFileSync(SSL_FULLCHAIN_PATH),
  key        : fs.readFileSync(SSL_KEY_PATH)
}, new AssetCollection({ path: ASSETS_PATH, hostname: HOSTNAME }).handler);
```

Since it’s not recommended to use this right now, given that node’s http2 lib is
not yet finalized, I’m not gonna go super deep documenting this; instead, take
a peek at the cod — figuring out how the http2 compatibility API works was quite
a journey so I’m hoping that what I learned might be useful to others. (Caveat,
of course, is that I absolutely do not know if I did stuff "right", only that it
seems to work).

The constructor takes an options object with the following keys:

- `fallback` is an optional asset path (relative to the assets dir) for non-200s
- `path` is the qualified path to an assets directory (required)
- `hostname` is the hostname without slashes, e.g. `"foo.com"` (required)
- `handle404` is an optional (req, res) handler for 404 cases

If `handle404` is provided, remember that http2 requests and responses are a bit
different from http1. The function should return true or false (or a promise
that fulfills with true or false); if `true`, that means you handled it, if not,
we’ll still send a 404 response.

`AssetCollection` exposes the generated asset objects as `assets`, which you
could tweak and do other stuff with or write your own handler for. There is also
a method to print the resources with their deps (flattened) which can be useful
for debugging:

```
console.log(assetCollection.renderDeps());
```

Probably important to note: relative specifiers are fine, but they’re URLs. It’s
not like node or webpack, it’s browser URL resolution. So this doesn’t support
reaching outside the assets directory, e.g. into node_modules, right now; nor
does it know about package.json files or that when you typed "./foo" you meant
"./foo/index.js", etc. However you can use "/" paths like "/foo/index.js" to
always be relative to the hostname, which can be nice for clarity imo.

**Tip 1!**

> In your html, `<script type="module">` needs to have
> `crossorigin="use-credentials"` in order for HTTP2 push-promised resources to
> be acknowledged — a bit strange looking, given it’s actually the same origin,
> but it has to do with the fact that the original document request is made with
> credentials by the browser, while by default, scripts are requested without
> them; the browser must treat with/without requests as if they are different
> resources, so it will decide that the es module sent (with cred) is not the
> same as the one indicated by the script element unless you add this attribute.

**Tip 2!**

> Although node’s new http2 module can do secure or insecure, browsers will only
> acknowledge HTTP2 if it’s secure. Unless you’ve got a proxy layer, then, only
> `createSecureServer` is of any utility. You can use "Let’s Encrypt" to create
> valid SSL certs for free. It’s not easy to set it up right unless you are
> sitting behind one of the blessed servers like Nginx, which typically isn’t
> the case for small-timey Node projects, but it can be done... bonus tip: don’t
> try to bring in a complex runtime lib for managing the certs — the existing
> options I found in the ecosystem don’t work with http2 and there’s a much
> better alternative anyway: set up a cron job that performs the renewal and
> restarts the app. It’s way simpler and there’s less surface area for stuff to
> go wrong.

**Tip 3!**

> You’re probably writing an SPA, so you’ll want any number of routes to point
> at an index.html asset or similar. Because AssetCollection exposes the assets
> as a map keying paths to asset objects at `assCollection.assets`, you can
> manipulate it to make multiple paths point at the same asset. Also, if you
> have patterned paths, you can always grab the assets directly from here. All
> around, doing HTTP2 push stuff can mean doing a lot more handholding in your
> asset-serving logic, but the results are pretty cool.

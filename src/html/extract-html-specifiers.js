const entities = require('./html-entities');

// The HTML grammar can be _radically_ reduced, for our purposes, to a smaller
// grammar. HTML, like CSS, normally has a grammar that describes a language
// which is the infinite set of all strings, but also defines a second more
// constrained language implicitly by indicating that certain productions are
// parse errors on which specific agents may abort. As explained in the readme
// above this one, we _assume_ that input contains no such errors, as this
// simplifies the problem and the consequences of failure for this to hold true
// will be both minor and obvious here. But in the case of HTML, I cannot call
// this a superset. Certain constructs are simply not handled, e.g. CDATA
// sections will be parsed as the bogus comment production regardless of whether
// this would be true in this position in HTML.

const refPattern = /&(?:#(?:(?:x)([A-F\d]+)|(\d+));?|([A-Z\d]+;?))/gi;

const dereference = str => str.replace(refPattern, replaceRef);

const replaceRef = (match, hex, dec, general) => {
  if (general) {
    for (const [ ref, value ] of entities) {
      if (general.startsWith(ref)) {
        if (general.length === ref.length) {
          return value;
        }

        return `${ value }${ general.slice(ref.length) }`;
      }
    }

    return match;
  }

  // The following instructions have been ignored due to their low
  // applicability to the domain of this problem, but is does represent a
  // divergence:
  //
  // > If the character reference is being consumed as part of an attribute,
  // > and the last character matched is not a ";" (U+003B) character, and the
  // > next character is either a "=" (U+003D) character or an alphanumeric
  // > ASCII character, then, for historical reasons, all the characters that
  // > were matched after the U+0026 AMPERSAND character (&) must be
  // > unconsumed, and nothing is returned. However, if this next character is
  // > in fact a "=" (U+003D) character, then this is a parse error, because
  // > some legacy user agents will misinterpret the markup in those cases.

  const cp = Number.parseInt(hex || dec, hex ? 16 : 10);

  switch (cp) {
    case 0x00: return '\uFFFD';
    case 0x80: return '\u20AC';
    case 0x82: return '\u201A';
    case 0x83: return '\u0192';
    case 0x84: return '\u201E';
    case 0x85: return '\u2026';
    case 0x86: return '\u2020';
    case 0x87: return '\u2021';
    case 0x88: return '\u02C6';
    case 0x89: return '\u2030';
    case 0x8A: return '\u0160';
    case 0x8B: return '\u2039';
    case 0x8C: return '\u0152';
    case 0x8E: return '\u017D';
    case 0x91: return '\u2018';
    case 0x92: return '\u2019';
    case 0x93: return '\u201C';
    case 0x94: return '\u201D';
    case 0x95: return '\u2022';
    case 0x96: return '\u2013';
    case 0x97: return '\u2014';
    case 0x98: return '\u02DC';
    case 0x99: return '\u2122';
    case 0x9A: return '\u0161';
    case 0x9B: return '\u203A';
    case 0x9C: return '\u0153';
    case 0x9E: return '\u017E';
    case 0x9F: return '\u0178';
    default:
      if (cp > 0x10FFFF || (cp > 0xD7FF && cp < 0xE000)) return '\uFFFD';
      return String.fromCodePoint(cp);
  }
};

module.exports = function * extractSpecifiersFromHTML(buf, customKeys) {
  let i = 0;
  let l = buf.length;
  let ignore = false;

  BYTE_LOOP: while (i < l) {
    ignore = false;

    if (buf[i++] === 0x3C) {
      switch (buf[i]) {
        case 0x21: // <!
          if (i+2 < l && buf[i+1] === 0x2D && buf[i+1] === 0x2D) {
            // <!-- Comment

            i+=3;

            // Immediate ">" or "->" is terminal:

            switch (buf[i]) {
              case 0x2D:
                if (buf[i+1] === 0x3E) {
                  i++;
                  continue;
                }
                break;
              case 0x3E:
                continue;
            }

            while (i < l) {
              if (buf[i] === 0x2D && i+1 < l && buf[i+1] === 0x2D) {
                // Having seen "--", we expect ">", but "!>" also leads to
                // termination.

                switch (buf[i+=2]) {
                  case 0x21:
                    if (++i < l && buf[i] === 0x3E) {
                      continue BYTE_LOOP;
                    } else {
                      break;
                    }
                  case 0x3E:
                    continue BYTE_LOOP;
                }
              } else {
                i++;
              }
            }

            continue;
          }
          // <!DOCTYPE, <![CDATA[, <!any, — fallthrough
          // this branch folds together all Doctype states (within which > is
          // always terminal, even in PUBLIC/SYSTEM IDs), the bogus comment
          // state, and the CDATA section state. The last of these is
          // deliberately _not_ handled correctly and it’s on account of this
          // exception (and that noted in the dereference logic) that we’re
          // technically not doing a superset grammar here. The reason is that
          // the circumstances under which <![CDATA[ actually begins an
          // XML-syntax CDATA section (as opposed to starting a bogus comment)
          // are rare (must be in an exotic namespace) and would demand that we
          // maintain quite a bit of additional parsing state and manage
          // concerns like tag-balancing and knowing self-closing rules, etc;
          // but for this, all of that is entirely avoidable, and I did not feel
          // it could be worth the additional complexity and parse time to
          // handle this one special case (further, even without the special
          // handling, one would need a very contrived scenario to cause this
          // fact to lead to different results).
        case 0x3F:
          // <? is also "bogus comment state"
          while (++i < l && buf[i] !== 0x3E) continue;
          continue;
        case 0x2F:
          // </ is element tag close. Although this markup does not interest us,
          // attributes (though meaningless) may occur in specific sub-contexts
          // here; the production is effectively the same as element open tag.
          // Since quoted attribute values may contain ">", but quotes only
          // begin attribute values in specific positions, there aren’t any
          // shortcuts here. However, once we establish the start of the tag
          // name, we can simply set an ignore flag and fall through.
          switch (buf[++i]) {
            case 0x3E:
              i++; continue;
            case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46:
            case 0x47: case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C:
            case 0x4D: case 0x4E: case 0x4F: case 0x50: case 0x51: case 0x52:
            case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58:
            case 0x59: case 0x5A: case 0x61: case 0x62: case 0x63: case 0x64:
            case 0x65: case 0x66: case 0x67: case 0x68: case 0x69: case 0x6A:
            case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F: case 0x70:
            case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76:
            case 0x77: case 0x78: case 0x79: case 0x7A:
              ignore = true;
              break;
            default:
              // "</" followed by anything non-alphabetic is yet another bogus
              // comment state:
              while (++i < l && buf[i] !== 0x3E) continue;
              continue;
          }
        case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46:
        case 0x47: case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C:
        case 0x4D: case 0x4E: case 0x4F: case 0x50: case 0x51: case 0x52:
        case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58:
        case 0x59: case 0x5A: case 0x61: case 0x62: case 0x63: case 0x64:
        case 0x65: case 0x66: case 0x67: case 0x68: case 0x69: case 0x6A:
        case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F: case 0x70:
        case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76:
        case 0x77: case 0x78: case 0x79: case 0x7A: {
          NAME_LOOP: while (++i < l) {
            switch (buf[i]) {
              case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                break NAME_LOOP;
              case 0x2F: case 0x3E:
                // No need to establish anything about what follows on "/"; the
                // regular loop will handle it the same.
                i++; continue BYTE_LOOP;
            }
          }

          // Here we can see one or more attributes — and that’s what we’re
          // interested in. Attributes have a rather diverse grammar in HTML,
          // unlike XML. First, a key may stand alone or be paired with a value:
          //
          // key
          // key WS* = WS* value
          //
          // The key itself need not be a valid attribute name for us to parse
          // it as if it were, and it will make no difference to our result
          // either way. The value may be quoted or bare, and the value may
          // include general entity references (even if bare).

          ATTR_LOOP: while (i < l) {
            WS_LOOP: while (++i < l) {
              switch (buf[i]) {
                case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                  i++; continue;
                case 0x2F: case 0x3E:
                  i++; continue BYTE_LOOP;
                default:
                  break WS_LOOP;
              }
            }

            // Whatever buf[i] is now is the first character of an attribute’s
            // key. This is true even if the character is "=" etc; though
            // invalid, the path is the same, and it will make no difference to
            // us to distinguish.

            let start = i;
            let end   = i;

            KEY_LOOP: while (i < l) {
              switch (buf[i]) {
                case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                  end = i;

                  while (++i < l) {
                    switch (buf[i]) {
                      case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                        continue;
                      case 0x2F: case 0x3E:
                        i++; continue BYTE_LOOP;
                      case 0x3D:
                        break KEY_LOOP;
                      default:
                        // A new key (the last had no value; we don’t need it)
                        start = i;
                        end = i;
                        continue KEY_LOOP;
                    }
                  }
                case 0x2F: case 0x3E:
                  i++; continue BYTE_LOOP;
                case 0x3D:
                  end = i;
                  break KEY_LOOP;
                default:
                  i++;
              }
            }

            // At this juncture we have the start and end values of a key and
            // the current buf[i] is an equals sign.

            const key = buf.toString('utf8', start, end).toLowerCase();

            {

              let mayIncludeEntityReference = false;
              let start = i;
              let end = i;
              let shouldContinueAttrs = true;

              BEFORE_VALUE_LOOP: while (++i < l) {
                switch (buf[i]) {
                  case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                    continue;
                  case 0x22:
                  case 0x27: {
                    const delim = buf[i++];
                    start = i;
                    QUOTED_VALUE_LOOP: while (i < l) {
                      switch (buf[i++]) {
                        case delim: break QUOTED_VALUE_LOOP;
                        case 0x26: mayIncludeEntityReference = true;
                      }
                    }
                    end = i - 1;
                    break BEFORE_VALUE_LOOP;
                  }
                  case 0x3E:
                    i++; continue BYTE_LOOP;
                  default:
                    start = i;
                    BARE_VALUE_LOOP: while (i < l) {
                      switch (buf[i++]) {
                        case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                          end = i - 1;
                          break BEFORE_VALUE_LOOP;
                        case 0x26:
                          mayIncludeEntityReference = true;
                          continue;
                        case 0x3E:
                          end = i - 1;
                          shouldContinueAttrs = false;
                          break BEFORE_VALUE_LOOP;
                      }
                    }
                }
              }

              // Note that 'srcset' is not considered. This is because it’s not
              // possible for the backend to determine which srcset url to push
              // promise — certainly it would not send all of them; it seems
              // that to make any assumptions here would defeat one of the key
              // purposes of srcset, bandwidth reduction.

              if (!ignore) {
                let shouldYield = false;

                if (customKeys !== undefined) {
                  shouldYield = customKeys.has(key);
                } else {
                  switch (key) {
                    case 'xlink:href':
                    case 'href':
                    case 'src':
                    case 'srcdoc':
                      shouldYield = true;
                  }
                }

                if (shouldYield) {
                  let str = buf.toString('utf8', start, end);

                  if (mayIncludeEntityReference) str = dereference(str);

                  yield [ str.trim(), key ];
                }
              }

              if (shouldContinueAttrs) continue ATTR_LOOP;
              else continue BYTE_LOOP;
            }
          }
        }
      }
    }
  }
};

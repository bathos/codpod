// CSS, moreso than HTML or ES, affords us a lot of shortcuts (remembering that
// we assume always that input is valid). We do not need to handle any
// punctuation except that which begins tokens that could have sequences that
// could otherwise be recognizes incorrectly as urls, e.g. comments or strings.
//
// The superset grammar, which can be realized entirely at the lexical level,
// becomes (operating on bytes, not codepoints) something like this:
//
// Comment
//  | 0x2F 0x2A CommentChar* 0x2A 0x2F
//  ;
//
// CommentChar
//  | [0x00-0x29]
//  | [0x2B-0xFF]
//  | 0x2A (?! 0x2F)
//  ;
//
// EscapeContinueChar
//  | [0x00-0x09]
//  | 0x0B
//  | [0x0E-0xFF]
//  ;
//
// FunctionToken
//  | Ident 0x28
//  ;
//
// GarbageToken
//  | Comment
//  | FunctionToken <when not URLFunctionToken>
//  | HashOrAtKeyword <when not ImportToken>
//  | IdentToken
//  | String
//  | <any other byte>
//  ;
//
// HashOrAtKeyword
//  | 0x23 Ident
//  | 0x40 Ident
//  ;
//
// Ident
//  | IdentStart IdentContinue*
//  ;
//
// IdentContinue
//  | 0x2D
//  | [0x30-0x39]
//  | [0x41-0x5A]
//  | 0x5C EscapeContinueChar
//  | 0x5F
//  | [0x61-0x7A]
//  ;
//
// IdentStart
//  | 0x2D 0x2D
//  | 0x2D [0x41-0x5A]
//  | 0x2D 0x59
//  | 0x2D 0x5C EscapeContinueChar
//  | 0x2D [0x61-0x7A]
//  | [0x41-0x5A]
//  | 0x59
//  | 0x5C EscapeContinueChar
//  | [0x61-0x7A]
//  ;
//
// IdentToken
//  | Ident (?! 0x28)
//  ;
//
// ImportToken
//  | HashOrAtKeyword <where string value is "@import", case insensitive>
//  ;
//
// String
//  | 0x22 StringDoubleChar* 0x22
//  | 0x27 StringSingleChar* 0x27
//  ;
//
// StringDoubleChar
//  | 0x5C [0x00-0xFF]
//  | [0x00-0x21]
//  | [0x23-0x5E]
//  | [0x60-0xFF]
//  ;
//
// StringSingleChar
//  | 0x5C [0x00-0xFF]
//  | [0x00-0x26]
//  | [0x28-0x5E]
//  | [0x60-0xFF]
//  ;
//
// Token
//  | GarbageToken
//  | URL
//  ;
//
// URL
//  | URLFunctionToken WS* URLChar*
//  | URLFunctionToken WS* String
//  | ImportToken String
//  ;
//
// URLChar
//  | 0x21
//  | [0x23-0x26]
//  | [0x2A-0x7E]
//  | [0x80-0xFF]
//  ;
//
// URLFunctionToken
//  | FunctionToken <where the string value is "url(", case insensitive>
//  ;
//
// WS
//  | 0x09
//  | 0x0A
//  | 0x0C
//  | 0x0D
//  | 0x20
//  ;

const escPattern = /\\([\dA-F]{1,6}|.)/gi;

const hexPattern = /[\dA-F]/i;

const hexToCP = esc => String.fromCodePoint(Number.parseInt(esc.slice(1)));

const importPattern = /import/i;

const unescape = esc => hexPattern.test(esc) ? hexToCP(esc) : esc.slice(1);

const urlPattern = /^url$/i;

const isNameContinue = byte => {
  switch (byte) {
    case 0x2D: case 0x30: case 0x31: case 0x33: case 0x34: case 0x35: case 0x36:
    case 0x37: case 0x38: case 0x39: case 0x41: case 0x42: case 0x43: case 0x44:
    case 0x45: case 0x46: case 0x47: case 0x48: case 0x49: case 0x4A: case 0x4B:
    case 0x4C: case 0x4D: case 0x4E: case 0x4F: case 0x50: case 0x51: case 0x52:
    case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58: case 0x59:
    case 0x5A: case 0x5F: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65:
    case 0x66: case 0x67: case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C:
    case 0x6D: case 0x6E: case 0x6F: case 0x70: case 0x71: case 0x72: case 0x73:
    case 0x74: case 0x75: case 0x76: case 0x77: case 0x78: case 0x79: case 0x7A:
      return true;
    default:
      return byte > 0x7F;
  }
};

const isNameStart = byte => {
  switch (byte) {
    case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
    case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E:
    case 0x4F: case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55:
    case 0x56: case 0x57: case 0x58: case 0x59: case 0x5A: case 0x5F: case 0x61:
    case 0x62: case 0x63: case 0x64: case 0x65: case 0x66: case 0x67: case 0x68:
    case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F:
    case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76:
    case 0x77: case 0x78: case 0x79: case 0x7A:
      return true;
    default:
      return byte > 0x7F;
  }
};

const isURL = (buf, hasEscapes) => hasEscapes
  ? urlPattern.test(buf.toString().replace(escPattern, unescape))
  : (
    (buf[0] === 0x55 || buf[0] === 0x75) &&
    (buf[1] === 0x52 || buf[1] === 0x72) &&
    (buf[2] === 0x4C || buf[2] === 0x6C)
  );

const isValidEscapeContinue = byte => {
  switch (byte) {
    case 0x0A:
    case 0x0C:
    case 0x0D:
      return false;
    default:
      return true;
  }
};

const nextIsIdent = (buf, l, i) => {
  if (i + 2 >= l) return false; // for our purposes, answer does not matter here

  switch (buf[i]) {
    case 0x2D:
      switch (buf[i+1]) {
        case 0x2D:
          return true;
        case 0x5C:
          return isValidEscapeContinue(buf[i+2]);
        default:
          return isNameStart(buf[i+1]);
      }
    case 0x5C:
      return isValidEscapeContinue(buf[i+1]);
    default:
      return isNameStart(buf[i]);
  }
};

module.exports = function * extractSpecifiersFromCSS(buf) {
  let i = 0;
  let l = buf.length;
  let j = buf.length - 5; // shortest possible url token is 6 bytes

  let at       = false;
  let atImport = false;
  let ignore   = false;

  BYTE_LOOP: while (i < j) {
    switch (buf[i]) {
      case 0x22:
      case 0x27: {
        const delim = buf[i];

        let hasEscapes = true;
        let start = i + 1;

        while (++i < l) {
          switch (buf[i]) {
            case delim: {
              if (atImport) {
                atImport = false;

                const str = hasEscapes
                  ? buf.toString('utf8', start, i).replace(escPattern, unescape)
                  : buf.toString('utf8', start, i);

                yield str;
              }

              i++; continue BYTE_LOOP;
            }
            case 0x5C: {
              hasEscapes = true;
              i++;
            }
            default: continue;
          }
        }
      }
      case 0x40:
        at = true;
      case 0x23:
        ignore = nextIsIdent(buf, l, ++i);
        continue;
      case 0x2F:
        if (++i < l && buf[i] === 0x2A) {
          while (++i < l) {
            if (buf[i] === 0x2A) {
              while (buf[++i] === 0x2A) continue;
              if (buf[i] === 0x2F) {
                i++;
                continue BYTE_LOOP;
              }
            }
          }
        }
        continue;
      default:
        if (nextIsIdent(buf, l, i)) {
          const start = i;
          let hasEscapes = false;

          IDENT_LOOP: while (i < l) {
            switch (buf[i]) {
              case 0x5C:
                if (i + 1 < l && isValidEscapeContinue(buf[i+1])) {
                  hasEscapes = true;
                  i += 2;
                  continue;
                }
                break IDENT_LOOP;
              default:
                if (isNameContinue(buf[i])) {
                  i++;
                  continue;
                }
                break IDENT_LOOP;
            }
          }

          if (at) {
            at = false;
            ignore = false;

            const str = hasEscapes
              ? buf.toString('utf8', start, i).replace(escPattern, unescape)
              : buf.toString('utf8', start, i);

            if (importPattern.test(str)) {
              WS_LOOP: while (i < l) {
                switch (buf[i]) {
                  case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                    i++; continue;
                  default:
                    break WS_LOOP;
                }
              }

              switch (buf[i]) {
                case 0x22:
                case 0x27:
                  atImport = true;
                default:
                  continue;
              }
            }
          }

          if (ignore) {
            ignore = false;
            continue;
          }

          const length = i - start;

          if (buf[i] === 0x28 && (length === 3 || hasEscapes && length > 3)) {
            const sub = buf.slice(start, i);

            i++;

            if (isURL(buf.slice(start, i), hasEscapes)) {
              WS_LOOP: while (i < l) {
                switch (buf[i+1]) {
                  case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                    i++; continue;
                  default:
                    break WS_LOOP;
                }
              }

              let sub;
              let hasEscapes = false;
              let pearShaped = false;

              switch (buf[i]) {
                case 0x29:
                  i++;
                  continue;
                case 0x22:
                case 0x27: {
                  const delim = buf[i];
                  const start = ++i;

                  URL_STRING_LOOP: while (i <= l) {
                    switch (i in buf ? buf[i] : delim) {
                      case delim:
                        sub = buf.slice(start, i);
                        i++;
                        break URL_STRING_LOOP;
                      case 0x5C:
                        if (i + 1 < l) {
                          hasEscapes = true;
                          i += 2;
                          continue;
                        }

                        break URL_STRING_LOOP;
                      default:
                        i++;
                    }
                  }

                  break;
                }
                default: {
                  const start = i;

                  URL_LOOP: while (i <= l) {
                    switch (i in buf ? buf[i] : 0x29) {
                      case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                        i++;
                        break URL_LOOP;
                      case 0x00: case 0x01: case 0x02: case 0x03: case 0x04:
                      case 0x05: case 0x06: case 0x07: case 0x08: case 0x0B:
                      case 0x0E: case 0x0F: case 0x10: case 0x11: case 0x12:
                      case 0x13: case 0x14: case 0x15: case 0x16: case 0x17:
                      case 0x18: case 0x19: case 0x1A: case 0x1B: case 0x1C:
                      case 0x1D: case 0x1E: case 0x1F: case 0x22: case 0x27:
                      case 0x28: case 0x7F:
                        pearShaped = true;
                        break URL_LOOP;
                      case 0x29:
                        break URL_LOOP;
                      case 0x5C:
                        if (i + 1 < l && isValidEscapeContinue(buf[i+1])) {
                          hasEscapes = true;
                          i += 2;
                          continue;
                        }
                        pearShaped = true;
                        break URL_LOOP;
                      default:
                        i++;
                    }
                  }

                  sub = buf.slice(start, i);
                }
              }

              WS_LOOP: while (i < l) {
                switch (buf[i]) {
                  case 0x09: case 0x0A: case 0x0C: case 0x0D: case 0x20:
                    i++; continue;
                  default:
                    break WS_LOOP;
                }
              }

              if (pearShaped || (i in buf && buf[i] !== 0x29)) {
                PEAR_LOOP: while (++i < l) {
                  switch (buf[i]) {
                    case 0x5C: i++;
                    case 0x29: break PEAR_LOOP;
                  }
                }

                continue;
              }

              const url = hasEscapes
                ? sub.toString().replace(escPattern, unescape)
                : sub.toString();

              yield url;
            }
          }

          continue;
        }

        i++; continue;
    }
  }
};

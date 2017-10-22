const decodeToCPs = require('./sync-utf8-to-cps');

const {
  nonASCIIIdentContinue,
  nonASCIIIdentStart,
  nonIdentContinue
} = require('./es-identifier');

const isHex = cp => {
  switch (cp) {
    case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: case 0x36:
    case 0x37: case 0x38: case 0x39: case 0x41: case 0x42: case 0x43: case 0x44:
    case 0x45: case 0x46: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65:
    case 0x66:
      return true;
    default:
      return false;
  }
};

const stringValueOf = cps => {
  // Normally, we handle strings with a reduced production; however, when the
  // string is a specifier, we must parse it formally. What is received here is
  // raw content without delimiters, and it is not guaranteed to be well-formed.
  // We return the string value or, if malformed, undefined.

  const svCPs = new Uint32Array(cps.length);

  let i = 0;
  let j = 0;

  while (i < cps.length) {
    const cp = cps[i++];

    switch (cp) {
      case 0x005C:
        switch (cps[i++]) {
          case 0x000A: case 0x2028: case 0x2029:
            continue;
          case 0x000D:
            if (cps[i] === 0x00A) i++;
            continue;
          case 0x0030:
            if (cps[i] >= 0x30 && cps[i] <= 0x39) return;
            svCPs[j++] = 0x00;
            continue;
          case 0x0031: case 0x0032: case 0x0032: case 0x0033: case 0x0034:
          case 0x0035: case 0x0036: case 0x0037: case 0x0039:
            return;
          case 0x0062:
            svCPs[j++] = 0x08;
            continue;
          case 0x0066:
            svCPs[j++] = 0x0C;
            continue;
          case 0x006E:
            svCPs[j++] = 0x0A;
            continue;
          case 0x0072:
            svCPs[j++] = 0x0D;
            continue;
          case 0x0074:
            svCPs[j++] = 0x09;
            continue;
          case 0x0075: {
            const first = cps[i++];

            if (first === 0x7B) {
              if (!isHex(cps[i])) return;

              let svCP = toHexValue(cps[i++]);

              while (isHex(cps[i])) {
                svCP <<= 4;
                svCP |= toHexValue(cps[i++]);
              }

              if (svCP <= 0x10FFFF && cps[i++] === 0x7D) {
                svCPs[j++] = svCP;
                continue;
              }

              return;
            }

            if (isHex(first)) {
              const x2 = cps[i++];
              const x3 = cps[i++];
              const x4 = cps[i++];

              if (isHex(first) && isHex(x2) && isHex(x3) && isHex(x4)) {
                svCPs[j++] =
                  toHexValue(first) << 12 |
                  toHexValue(x2) << 8 |
                  toHexValue(x3) << 4 |
                  toHexValue(x4);
                continue;
              }

              return;
            }

            return;
          }
          case 0x0076:
            svCPs[j++] = 0x0B;
            continue;
          case 0x0078: {
            const x1 = cps[i++];
            const x2 = cps[i++];

            if (isHex(x1) && isHex(x2)) {
              svCPs[j++] = toHexValue(x1) << 4 | toHexValue(x2);
              continue;
            }

            return;
          }
          default:
            svCPs[j++] = cps[i - 1];
            continue;
        }
      case 0x000A:
      case 0x000D:
      case 0x2028:
      case 0x2029:
        return;
      default:
        svCPs[j++] = cp;
    }
  }

  if (i !== j) {
    return String.fromCodePoint(...svCPs.subarray(0, j));
  } else {
    return String.fromCodePoint(...svCPs);
  }
};

const toHexValue = cp => cp & 0b1000000 ? cp + 0x09 & 0b1111 : cp ^ 0b110000;

const BLOCK    = Symbol();
const BRACKET  = Symbol();
const NONE     = Symbol();
const OBJECT   = Symbol();
const PARENS   = Symbol();
const TEMPLATE = Symbol();
const TERNARY  = Symbol();

const TEMPLATE_CONTINUE = Symbol();
const TEMPLATE_END      = Symbol();

const EOF = 0x110000;

const ID            = Symbol();
const ID_AWAIT      = Symbol();
const ID_BREAK      = Symbol();
const ID_CASE       = Symbol();
const ID_CONST      = Symbol();
const ID_CONTINUE   = Symbol();
const ID_DEBUGGER   = Symbol();
const ID_DELETE     = Symbol();
const ID_DO         = Symbol();
const ID_ELSE       = Symbol();
const ID_EXPORT     = Symbol();
const ID_EXTENDS    = Symbol();
const ID_FETCH      = Symbol();
const ID_FOR        = Symbol();
const ID_IF         = Symbol();
const ID_IMPORT     = Symbol();
const ID_IN         = Symbol();
const ID_INSTANCEOF = Symbol();
const ID_NEW        = Symbol();
const ID_RETURN     = Symbol();
const ID_THROW      = Symbol();
const ID_TYPEOF     = Symbol();
const ID_VAR        = Symbol();
const ID_VOID       = Symbol();
const ID_WHILE      = Symbol();
const ID_YIELD      = Symbol();

class ESSpecifierExtractor {
  constructor(buf) {
    this.balance      = [];
    this.braceIsBlock = true;
    this.cps          = decodeToCPs(buf);
    this.index        = 0;
    this.lineBroke    = false;
    this.parenState   = 0;
    this.property     = false;
    this.slashIsRegex = true;
  }

  get cp() {
    return this.cps[this.index];
  }

  get currentBalance() {
    return this.balance.length !== 0
      ? this.balance[this.balance.length - 1]
      : NONE;
  }

  get hasCPs() {
    return this.index < this.cps.length;
  }

  get isAtModuleScope() {
    return !this.balance.includes(BLOCK);
  }

  get nextCP1() {
    return this.index + 1 in this.cps ? this.cps[this.index + 1] : EOF;
  }

  get nextCP2() {
    return this.index + 2 in this.cps ? this.cps[this.index + 2] : EOF;
  }

  get nextCP3() {
    return this.index + 3 in this.cps ? this.cps[this.index + 3] : EOF;
  }

  get nextCP4() {
    return this.index + 4 in this.cps ? this.cps[this.index + 4] : EOF;
  }

  get nextCP5() {
    return this.index + 5 in this.cps ? this.cps[this.index + 5] : EOF;
  }

  get nextCP6() {
    return this.index + 6 in this.cps ? this.cps[this.index + 6] : EOF;
  }

  get nextCP7() {
    return this.index + 7 in this.cps ? this.cps[this.index + 7] : EOF;
  }

  get nextCP8() {
    return this.index + 8 in this.cps ? this.cps[this.index + 8] : EOF;
  }

  get nextCP9() {
    return this.index + 9 in this.cps ? this.cps[this.index + 9] : EOF;
  }

  get nextCPA() {
    return this.index + 10 in this.cps ? this.cps[this.index + 10] : EOF;
  }

  consumeCPs(n) {
    this.index += n;
  }

  consumeAnyFromClause() {
    while (this.hasCPs) {
      while (this.consumeAnyInterstitial()) continue;

      switch (this.cp) {
        case 0x22:
        case 0x27:
          return this.consumeAnyFromClauseSpecifier();
        default:
          this.consumeCPs(1);
      }
    }
  }

  consumeAnyFromClauseSpecifier() {
    const start = this.index + 1;

    if (!this.consumeStringLiteral()) return;

    const end = this.index - 1;

    this.braceIsBlock = true;
    this.lineBroke    = false;
    this.property     = false;
    this.slashIsRegex = true;

    return stringValueOf(this.cps.subarray(start, end));
  }

  consumeAnyIdent() {
    switch (this.cp) {
      case 0x61:
        if (
          this.nextCP1 === 0x77 &&
          this.nextCP2 === 0x61 &&
          this.nextCP3 === 0x69 &&
          this.nextCP4 === 0x74 &&
          nonIdentContinue(this.nextCP5)
        ) {
          this.consumeCPs(5);
          return ID_AWAIT;
        }
        break;
      case 0x62:
        if (
          this.nextCP1 === 0x72 &&
          this.nextCP2 === 0x65 &&
          this.nextCP3 === 0x61 &&
          this.nextCP4 === 0x6B &&
          nonIdentContinue(this.nextCP5)
        ) {
          this.consumeCPs(5);
          return ID_BREAK;
        }
        break;
      case 0x63:
        switch (this.nextCP1) {
          case 0x61:
            if (
              this.nextCP2 === 0x73 &&
              this.nextCP3 === 0x65 &&
              nonIdentContinue(this.nextCP4)
            ) {
              this.consumeCPs(4);
              return ID_CASE;
            }
            break;
          case 0x6F:
            if (this.nextCP2 === 0x6E) {
              switch (this.nextCP3) {
                case 0x73:
                  if (this.nextCP4 === 0x64 && nonIdentContinue(this.nextCP5)) {
                    this.consumeCPs(5);
                    return ID_CONST;
                  }
                  break;
                case 0x74:
                  if (
                    this.nextCP4 === 0x69 &&
                    this.nextCP5 === 0x6E &&
                    this.nextCP6 === 0x75 &&
                    this.nextCP7 === 0x65 &&
                    nonIdentContinue(this.nextCP8)
                  ) {
                    this.consumeCPs(8);
                    return ID_CONTINUE;
                  }
              }
            }
        }
        break;
      case 0x64:
        switch (this.nextCP1) {
          case 0x65:
            switch (this.nextCP2) {
              case 0x62:
                if (
                  this.nextCP3 === 0x75 &&
                  this.nextCP4 === 0x67 &&
                  this.nextCP5 === 0x67 &&
                  this.nextCP6 === 0x65 &&
                  this.nextCP7 === 0x72 &&
                  nonIdentContinue(this.nextCP8)
                ) {
                  this.consumeCPs(8);
                  return ID_DEBUGGER;
                }
                break;
              case 0x6C:
                if (
                  this.nextCP3 === 0x6C &&
                  this.nextCP4 === 0x65 &&
                  this.nextCP5 === 0x74 &&
                  this.nextCP6 === 0x65 &&
                  nonIdentContinue(this.nextCP7)
                ) {
                  this.consumeCPs(7);
                  return ID_DELETE;
                }
            }
            break;
          case 0x6F:
            if (nonIdentContinue(this.nextCP2)) {
              this.consumeCPs(2);
              return ID_DO;
            }
        }
        break;
      case 0x65:
        switch (this.nextCP1) {
          case 0x6C:
            if (
              this.nextCP2 === 0x73 &&
              this.nextCP3 === 0x65 &&
              nonIdentContinue(this.nextCP4)
            ) {
              this.consumeCPs(4);
              return ID_ELSE;
            }
            break;
          case 0x78:
            switch (this.nextCP2) {
              case 0x70:
                if (
                  this.nextCP3 === 0x6F &&
                  this.nextCP4 === 0x72 &&
                  this.nextCP5 === 0x74 &&
                  nonIdentContinue(this.nextCP6)
                ) {
                  this.consumeCPs(6);
                  return ID_EXPORT;
                }
                break;
              case 0x74:
                if (
                  this.nextCP3 === 0x65 &&
                  this.nextCP4 === 0x6E &&
                  this.nextCP5 === 0x64 &&
                  this.nextCP6 === 0x73 &&
                  nonIdentContinue(this.nextCP7)
                ) {
                  this.consumeCPs(7);
                  return ID_EXTENDS;
                }
            }
        }
        break;
      case 0x66:
        switch (this.nextCP1) {
          case 0x65:
            if (
              this.nextCP2 === 0x74 &&
              this.nextCP3 === 0x63 &&
              this.nextCP4 === 0x68 &&
              nonIdentContinue(this.nextCP5)
            ) {
              this.consumeCPs(5);
              return ID_FETCH;
            }
            break;
          case 0x6F:
            if (this.nextCP2 === 0x72 && nonIdentContinue(this.nextCP3)) {
              this.consumeCPs(3);
              return ID_FOR;
            }
        }
        break;
      case 0x69:
        switch (this.nextCP1) {
          case 0x66:
            if (nonIdentContinue(this.nextCP2)) {
              this.consumeCPs(2);
              return ID_IF;
            }
            break;
          case 0x6D:
            if (
              this.nextCP2 === 0x70 &&
              this.nextCP3 === 0x6F &&
              this.nextCP4 === 0x72 &&
              this.nextCP5 === 0x74 &&
              nonIdentContinue(this.nextCP6)
            ) {
              this.consumeCPs(6);
              return ID_IMPORT;
            }
            break;
          case 0x6E:
            if (
              this.nextCP2 === 0x73 &&
              this.nextCP3 === 0x74 &&
              this.nextCP4 === 0x61 &&
              this.nextCP5 === 0x6E &&
              this.nextCP6 === 0x63 &&
              this.nextCP7 === 0x65 &&
              this.nextCP8 === 0x6F &&
              this.nextCP9 === 0x66 &&
              nonIdentContinue(this.nextCPA)
            ) {
              this.consumeCPs(10);
              return ID_INSTANCEOF;
            }

            if (nonIdentContinue(this.nextCP2)) {
              this.consumeCPs(2);
              return ID_IN;
            }
        }
        break;
      case 0x6E:
        if (
          this.nextCP1 === 0x65 &&
          this.nextCP2 === 0x77 &&
          nonIdentContinue(this.nextCP3)
        ) {
          this.consumeCPs(3);
          return ID_NEW;
        }
        break;
      case 0x72:
        if (
          this.nextCP1 === 0x65 &&
          this.nextCP2 === 0x74 &&
          this.nextCP3 === 0x75 &&
          this.nextCP4 === 0x72 &&
          this.nextCP5 === 0x6E &&
          nonIdentContinue(this.nextCP6)
        ) {
          this.consumeCPs(6);
          return ID_RETURN;
        }
        break;
      case 0x74:
        switch (this.nextCP1) {
          case 0x68:
            if (
              this.nextCP2 === 0x72 &&
              this.nextCP3 === 0x6F &&
              this.nextCP4 === 0x77 &&
              nonIdentContinue(this.nextCP5)
            ) {
              this.consumeCPs(5);
              return ID_THROW;
            }
            break;
          case 0x79:
            if(
              this.nextCP2 === 0x70 &&
              this.nextCP3 === 0x65 &&
              this.nextCP4 === 0x6F &&
              this.nextCP5 === 0x66 &&
              nonIdentContinue(this.nextCP6)
            ) {
              this.consumeCPs(6);
              return ID_TYPEOF;
            }
        }
        break;
      case 0x76: // var void
        switch (this.nextCP1) {
          case 0x61:
            if (this.nextCP2 === 0x72 && nonIdentContinue(this.nextCP3)) {
              this.consumeCPs(3);
              return ID_VAR;
            }
            break;
          case 0x6F:
            if (
              this.nextCP2 === 0x69 &&
              this.nextCP3 === 0x64 &&
              nonIdentContinue(this.nextCP4)
            ) {
              this.consumeCPs(4);
              return ID_VOID;
            }
        }
      case 0x77:
        if (
          this.nextCP1 === 0x68 &&
          this.nextCP2 === 0x69 &&
          this.nextCP3 === 0x6C &&
          this.nextCP4 === 0x65 &&
          nonIdentContinue(this.nextCP5)
        ) {
          this.consumeCPs(5);
          return ID_WHILE;
        }
        break;
      case 0x79:
        if (
          this.nextCP1 === 0x69 &&
          this.nextCP2 === 0x65 &&
          this.nextCP3 === 0x6C &&
          this.nextCP4 === 0x64 &&
          nonIdentContinue(this.nextCP5)
        ) {
          this.consumeCPs(5);
          return ID_YIELD;
        }
    }

    switch (this.cp) {
      case 0x24: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45:
      case 0x46: case 0x47: case 0x48: case 0x49: case 0x4A: case 0x4B:
      case 0x4C: case 0x4D: case 0x4E: case 0x4F: case 0x50: case 0x51:
      case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57:
      case 0x58: case 0x59: case 0x5A: case 0x5F: case 0x61: case 0x62:
      case 0x63: case 0x64: case 0x65: case 0x66: case 0x67: case 0x68:
      case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6E:
      case 0x6F: case 0x70: case 0x71: case 0x72: case 0x73: case 0x74:
      case 0x75: case 0x76: case 0x77: case 0x78: case 0x79: case 0x7A:
        this.consumeCPs(1);
        this.continueConsumingIdent();
        return ID;
      case 0x5C:
        this.consumeCPs(2);
        this.consumeRestOfIdentEscape();
        this.continueConsumingIdent();
        return ID;
      default:
        if (this.cp > 0x7F && nonASCIIIdentStart.has(this.cp)) {
          this.consumeCPs(1);
          this.continueConsumingIdent();
          return ID;
        }

        return NONE;
    }
  }

  consumeAnyInterstitial() {
    switch (this.cp) {
      case 0x0009: case 0x000B: case 0x000C: case 0x0020: case 0x00A0:
      case 0x1680: case 0x2000: case 0x2001: case 0x2002: case 0x2003:
      case 0x2004: case 0x2005: case 0x2006: case 0x2007: case 0x2008:
      case 0x2009: case 0x200A: case 0x202F: case 0x205F: case 0x3000:
      case 0xFEFF:
        this.consumeCPs(1);
        return true;
      case 0x000A:
      case 0x000D:
      case 0x2028:
      case 0x2029:
        this.lineBroke = true;
        this.consumeCPs(1);
        return true;
      case 0x002F:
        switch (this.nextCP1) {
          case 0x002A:
            this.consumeCPs(2);
            this.consumeRestOfMultiLineComment();
            return true;
          case 0x002F:
            this.consumeCPs(2);
            this.consumeRestOfSingleLineComment();
            return true;
        }
      default:
        return false;
    }
  }

  consumeExportStatement() {
    // There are a few ways that an export statement can also be an import:
    //
    // "export" "*" "from" StringLiteral ";"
    // "export" "{" "}" "from" StringLiteral ";"
    // "export" "{" ExportsList "}" "from" StringLiteral ";"
    // "export" "{" ExportsList "," "}" "from" StringLiteral ";"
    //
    // (where ExportsList is unexpanded, but is all idents and commas)
    //
    // There are many other types of export statements, so the first thing to do
    // is establish that the first semantic token is either "*" or "{".
    //
    // If it is "*", then we can actually proceed identically to
    // consumeImportStatement — just chug along bling till we hit a string.
    //
    // If it is "{", then a specifier is not guaranteed. Instead we chug along
    // for the final brace (there can be no nesting) and sniff for the string,
    // which may not be there.
    //
    // Finally, there is a special case to account for. If the first item was
    // not "*" or "{" but was "d", then it must be "default". Since this token,
    // which influences subsequent lexing, is not otherwise handled, we’ll take
    // case of it from here, even though it’s not going to lead to a specifier.

    while (this.consumeAnyInterstitial()) continue;

    switch (this.cp) {
      case 0x2A:
        this.consumeCPs(1);
        return this.consumeAnyFromClause();
      case 0x7B:
        this.consumeCPs(1);
        break;
      case 0x64:
        this.consumeCPs(7);
        this.braceIsBlock = false;
        this.lineBroke    = false;
        this.property     = false;
        this.slashIsRegex = true;
        return;
    }

    while (this.hasCPs) {
      while (this.consumeAnyInterstitial()) continue;

      if (this.cp === 0x7D) break;

      this.consumeCPs(1);
    }

    this.consumeCPs(1);

    while (this.consumeAnyInterstitial()) continue;

    if (
      this.cp === 0x66 &&
      this.nextCP1 === 0x72 &&
      this.nextCP2 === 0x6F &&
      this.nextCP3 === 0x6D &&
      nonIdentContinue(this.nextCP4)
    ) {
      this.consumeCPs(4);
      return this.consumeAnyFromClause();
    }

    this.braceIsBlock = true;
    this.lineBroke    = false;
    this.property     = false;
    this.slashIsRegex = true;
  }

  consumeFetchSpecifier() {
    let start = 0;
    let end   = 0;

    this.lineBroke = false;

    while (this.consumeAnyInterstitial()) continue;

    if (this.cp !== 0x28) {
      this.braceIsBlock = true;
      this.property     = false;
      this.slashIsRegex = false;
      return;
    }

    this.consumeCPs(1);

    while (this.consumeAnyInterstitial()) continue;

    switch (this.cp) {
      case 0x22: case 0x27:
        start = this.index + 1;

        this.consumeStringLiteral();

        end = this.index - 1;

        this.braceIsBlock = true;
        this.lineBroke    = false;
        this.property     = false;
        this.slashIsRegex = false;

        break;
      case 0x60:
        this.consumeCPs(1);

        start = this.index;

        switch (this.consumeRestOfTemplateToken()) {
          case TEMPLATE_CONTINUE:
            this.balance.push(TEMPLATE);
            this.braceIsBlock = false;
            this.slashIsRegex = true;
            break;
          case TEMPLATE_END:
            this.braceIsBlock = true;
            this.slashIsRegex = false;
            end = this.index - 1;
        }

        this.lineBroke = false;
        this.property  = false;
    }

    if (end !== 0) {
      return stringValueOf(this.cps.subarray(start, end));
    }
  }

  consumeImportStatement() {
    // There are many paths through import statements. However, they are ripe
    // for reduction given the presume-validity rule: in all of them, a single
    // string literal is guaranteed, and it will be the specifier and final
    // semantic token (aside from ";"). Therefore it would seem, in theory, that
    // we could just consume blindly until the first double or single quote
    // (stopping only to consume interstitials).
    //
    // However, it is not quite that simple. There is also the possibility of
    // dynamic import() expressions and, soon, the `import.meta` metaproperty.
    // So we need to do an extra check at the first semantic token found before
    // going into tunnel-vision mode.

    while (this.consumeAnyInterstitial()) continue;

    switch (this.cp) {
      case 0x28:
        // This is an import call. Return and let the main loop handle it.
      case 0x2E:
        // This is a metaproperty. Return and let the main loop handle it.
        return;
    }

    return this.consumeAnyFromClause();
  }

  consumeRestOfIdentEscape() {
    if (this.cp === 0x7B) {
      this.consumeCPs(1);
      while (this.hasCPs && this.cp !== 0x7D) this.consumeCPs(1);
      this.consumeCPs(1);
    } else {
      this.consumeCPs(4);
    }
  }

  consumeRestOfMultiLineComment() {
    while (this.hasCPs) {
      switch (this.cp) {
        case 0x000A:
        case 0x000D:
        case 0x2028:
        case 0x2029:
          this.lineBroke = true;
          break;
        case 0x002A:
          if (this.nextCP1 === 0x002F) {
            this.consumeCPs(2);
            return;
          }
      }

      this.consumeCPs(1);
    }
  }

  consumeRestOfRegexLiteral() {
    let inCharacterClass = false;

    while (this.hasCPs) {
      switch (this.cp) {
        case 0x2F:
          this.consumeCPs(1);
          if (inCharacterClass) continue;
          return;
        case 0x5B:
          this.consumeCPs(1);
          inCharacterClass = true;
          continue;
        case 0x5D:
          this.consumeCPs(1);
          inCharacterClass = false;
          continue;
        case 0x5C:
          this.consumeCPs(2);
          continue;
        default:
          this.consumeCPs(1);
      }
    }
  }

  consumeRestOfSingleLineComment() {
    while (this.hasCPs) {
      switch (this.cp) {
        case 0x000A:
        case 0x000D:
        case 0x2028:
        case 0x2029:
          return;
        default:
          this.consumeCPs(1);
      }
    }
  }

  consumeRestOfTemplateToken() {
    while (this.hasCPs) {
      switch (this.cp) {
        case 0x5C:
          this.consumeCPs(2);
          continue;
        case 0x60:
          this.consumeCPs(1);
          return TEMPLATE_END;
        case 0x24:
          if (this.nextCP1 === 0x7B) {
            this.consumeCPs(2);
            return TEMPLATE_CONTINUE;
          }
        default:
          this.consumeCPs(1);
      }
    }
  }

  consumeStringLiteral() {
    const delim = this.cp;

    this.consumeCPs(1);

    while (this.hasCPs) {
      switch (this.cp) {
        case delim:
          this.consumeCPs(1);
          return true;
        case 0x5C:
          this.consumeCPs(2);
          continue;
        default:
          this.consumeCPs(1);
      }
    }

    return false;
  }

  continueConsumingIdent() {
    while (this.hasCPs) {
      switch (this.cp) {
        case 0x24: case 0x30: case 0x31: case 0x32: case 0x33: case 0x34:
        case 0x35: case 0x36: case 0x37: case 0x38: case 0x39: case 0x41:
        case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
        case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D:
        case 0x4E: case 0x4F: case 0x50: case 0x51: case 0x52: case 0x53:
        case 0x54: case 0x55: case 0x56: case 0x57: case 0x58: case 0x59:
        case 0x5A: case 0x5F: case 0x61: case 0x62: case 0x63: case 0x64:
        case 0x65: case 0x66: case 0x67: case 0x68: case 0x69: case 0x6A:
        case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F: case 0x70:
        case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76:
        case 0x77: case 0x78: case 0x79: case 0x7A:
          this.consumeCPs(1);
          continue;
        case 0x5C:
          this.consumeCPs(2);
          this.consumeRestOfIdentEscape();
          continue;
        default:
          if (this.cp > 0x7F && nonASCIIIdentContinue.has(this.cp)) {
            this.consumeCPs(1);
            continue;
          }
          return;
      }
    }
  }

  next() {
    while (this.hasCPs) {
      if (this.consumeAnyInterstitial()) continue;

      switch (this.cp) {
        case 0x21: case 0x26: case 0x2A: case 0x3C:
        case 0x3E: case 0x5E: case 0x7C: case 0x7E:
          this.consumeCPs(1);

          this.braceIsBlock = false
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x22: case 0x27:
          this.consumeStringLiteral();

          this.braceIsBlock = true;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = false;

          continue;

        case 0x28:
          this.consumeCPs(1);
          this.balance.push(PARENS);

          if (this.parenState !== 0) this.parenState++;

          this.braceIsBlock = false;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x29:
          this.consumeCPs(1);
          this.balance.pop();

          if (this.parenState !== 0 && --this.parenState === 1) {
            this.parenState = 0;
            this.slashIsRegex = true;
          } else {
            this.slashIsRegex = false;
          }

          this.braceIsBlock = true;
          this.lineBroke    = false;
          this.property     = false;

          continue;

        case 0x2B: case 0x2D:
          if (this.cp === this.nextCP1) {
            this.consumeCPs(2);
            this.braceIsBlock = this.lineBroke;
            this.slashIsRegex = this.lineBroke || this.slashIsRegex;
          } else {
            this.consumeCPs(1);
            this.braceIsBlock = false;
            this.slashIsRegex = true;
          }

          this.lineBroke = false;
          this.property  = false;

          continue;

        case 0x2C:
          this.consumeCPs(1);

          this.braceIsBlock = false
          this.lineBroke    = false;
          this.property     = this.currentBalance === OBJECT;
          this.slashIsRegex = true;

          continue;

        case 0x2E:
          if (this.nextCP1 === 0x2E && this.nextCP2 === 0x2E) {
            this.consumeCPs(3);
            this.property     = false;
            this.slashIsRegex = true;
          } else {
            this.consumeCPs(1);
            this.property     = true;
            this.slashIsRegex = false;
          }

          this.braceIsBlock = false;
          this.lineBroke = false;

          continue;

        case 0x2F:
          this.consumeCPs(1);

          if (this.slashIsRegex) {
            this.consumeRestOfRegexLiteral();
            this.braceIsBlock = true;
            this.slashIsRegex = false;
          } else {
            this.braceIsBlock = false;
            this.slashIsRegex = true;
          }

          this.lineBroke = false;
          this.property  = false;

          continue;

        case 0x3A:
          this.consumeCPs(1);

          if (this.currentBalance === TERNARY) {
            this.balance.pop();
            this.braceIsBlock = false;
          } else {
            this.braceIsBlock = true;
          }

          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x3B:
          this.consumeCPs(1);

          this.braceIsBlock = this.currentBalance === BLOCK;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x3D:
          if (this.nextCP1 === 0x3E) {
            this.consumeCPs(2);
            this.braceIsBlock = true;
          } else {
            this.consumeCPs(1);
            this.braceIsBlock = false;
          }

          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue

        case 0x3F:
          this.consumeCPs(1);
          this.balance.push(TERNARY);

          this.braceIsBlock = false;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x5B:
          this.consumeCPs(1);
          this.balance.push(BRACKET);

          this.braceIsBlock = false
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = true;

          continue;

        case 0x5D:
          this.consumeCPs(1);
          this.balance.pop();

          this.braceIsBlock = true;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = false;

          continue;

        case 0x60:
          this.consumeCPs(1);

          switch (this.consumeRestOfTemplateToken()) {
            case TEMPLATE_CONTINUE:
              this.balance.push(TEMPLATE);
              this.braceIsBlock = false;
              this.slashIsRegex = true;
              break;
            case TEMPLATE_END:
              this.braceIsBlock = true;
              this.slashIsRegex = false;
          }

          this.lineBroke    = false;
          this.property     = false;

          continue;

        case 0x7B:
          this.consumeCPs(1);
          this.balance.push(this.braceIsBlock ? BLOCK : OBJECT);

          this.braceIsBlock = true;
          this.lineBroke    = false;
          this.property     = true;
          this.slashIsRegex = true;

          continue;

        case 0x7D:
          this.consumeCPs(1);

          if (this.currentBalance === TEMPLATE) {
            switch (this.consumeRestOfTemplateToken()) {
              case TEMPLATE_CONTINUE:
                this.braceIsBlock = false;
                this.slashIsRegex = true;
                break;
              case TEMPLATE_END:
                this.balance.pop();
                this.braceIsBlock = true;
                this.slashIsRegex = false;
            }
          } else {
            this.braceIsBlock = true;
            this.slashIsRegex = this.currentBalance === BLOCK;
            this.balance.pop();
          }

          this.lineBroke = false;
          this.property  = false;

          continue;

        default: {
          const ident = this.consumeAnyIdent();

          if (ident === NONE) {
            this.consumeCPs(1);
          } else if (!this.property && ident !== ID) {
            switch (ident) {
              case ID_EXPORT: {
                if (this.isAtModuleScope) {
                  const specifier = this.consumeExportStatement();

                  if (specifier !== undefined) {
                    return { done: false, value: [ specifier, 'import' ] };
                  }

                  continue;
                }
              }

              case ID_FETCH: {
                if (this.isAtModuleScope) {
                  const specifier = this.consumeFetchSpecifier();

                  if (specifier !== undefined) {
                    return { done: false, value: [ specifier, 'fetch' ] };
                  }

                  continue;
                }
              }

              case ID_IMPORT: {
                if (this.isAtModuleScope) {
                  const specifier = this.consumeImportStatement();

                  if (specifier !== undefined) {
                    return { done: false, value: [ specifier, 'import' ] };
                  }

                  continue;
                }
              }

              case ID_AWAIT:
              case ID_CASE:
              case ID_CONST:
              case ID_DELETE:
              case ID_EXTENDS:
              case ID_IN:
              case ID_INSTANCEOF:
              case ID_NEW:
              case ID_TYPEOF:
              case ID_VAR:
              case ID_VOID:
                this.braceIsBlock = false;
                this.lineBroke    = false;
                this.property     = false;
                this.slashIsRegex = true;
                continue;
              case ID_BREAK:
              case ID_CONTINUE:
              case ID_DEBUGGER:
              case ID_DO:
              case ID_ELSE:
                this.braceIsBlock = true;
                this.lineBroke    = false;
                this.property     = false;
                this.slashIsRegex = true;
                continue;
              case ID_THROW:
              case ID_RETURN:
              case ID_YIELD:
                this.braceIsBlock = this.lineBroke;
                this.lineBroke    = false;
                this.property     = false;
                this.slashIsRegex = true;
                continue;
              case ID_IF:
              case ID_FOR:
              case ID_WHILE:
                this.parenState = 1;
            }
          }

          this.braceIsBlock = true;
          this.lineBroke    = false;
          this.property     = false;
          this.slashIsRegex = false;
        }
      }
    }

    return { done: true, value: undefined };
  }

  [Symbol.iterator]() {
    return this;
  }
}

module.exports = buf => new ESSpecifierExtractor(buf);

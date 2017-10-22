// Deliberately permissive (but fast) conversion from utf8 buffer to codepoint
// array. Invalid multibyte codepoint sequences become replacement character and
// orphaned surrogates are expressly permitted.
//
// The speed is almost identical to the built-in TextDecoder; however, it yields
// an array of codepoints, rather than a string. When compared as ways to get
// codepoints (e.g. by following TextDecoder.end with map), this runs fourteen
// times faster (not because TextDecoder is slow, but because x.from(str, map)
// is — not sure what accounts for such a big difference, though it only reaches
// those extremes on large files).
//
// I wrote a general lib for this for _streams_ (codpoint), but in this case a
// stream would be inefficient; we have the buffers we need to operate on in
// memory already. Oh well, nothing is generic when you have a speed imp riding
// on your shoulder whispering "I bet this could be faster" all the time. (Also
// in this case I wanted FFFD replacement behavior rather than errors; codpoint
// is strict).

const cont = byte => {
  switch (byte) {
    case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x86:
    case 0x87: case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D:
    case 0x8E: case 0x8F: case 0x90: case 0x91: case 0x92: case 0x93: case 0x94:
    case 0x95: case 0x96: case 0x97: case 0x98: case 0x99: case 0x9A: case 0x9B:
    case 0x9C: case 0x9D: case 0x9E: case 0x9F: case 0xA0: case 0xA1: case 0xA2:
    case 0xA3: case 0xA4: case 0xA5: case 0xA6: case 0xA7: case 0xA8: case 0xA9:
    case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF: case 0xB0:
    case 0xB1: case 0xB2: case 0xB3: case 0xB4: case 0xB5: case 0xB6: case 0xB7:
    case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBE:
    case 0xBF: return byte & 0b111111;
    default: return 0x40;
  }
};

module.exports = buf => {
  const target = new Uint32Array(buf.length);

  let i = 0, j = 0, l = buf.length;

  while (i < l) {
    const byte = buf[i++];

    switch (byte) {
      case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x05:
      case 0x06: case 0x07: case 0x08: case 0x09: case 0x0A: case 0x0B:
      case 0x0C: case 0x0D: case 0x0E: case 0x0F: case 0x10: case 0x11:
      case 0x12: case 0x13: case 0x14: case 0x15: case 0x16: case 0x17:
      case 0x18: case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D:
      case 0x1E: case 0x1F: case 0x20: case 0x21: case 0x22: case 0x23:
      case 0x24: case 0x25: case 0x26: case 0x27: case 0x28: case 0x29:
      case 0x2A: case 0x2B: case 0x2C: case 0x2D: case 0x2E: case 0x2F:
      case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35:
      case 0x36: case 0x37: case 0x38: case 0x39: case 0x3A: case 0x3B:
      case 0x3C: case 0x3D: case 0x3E: case 0x3F: case 0x40: case 0x41:
      case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
      case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D:
      case 0x4E: case 0x4F: case 0x50: case 0x51: case 0x52: case 0x53:
      case 0x54: case 0x55: case 0x56: case 0x57: case 0x58: case 0x59:
      case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
      case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65:
      case 0x66: case 0x67: case 0x68: case 0x69: case 0x6A: case 0x6B:
      case 0x6C: case 0x6D: case 0x6E: case 0x6F: case 0x70: case 0x71:
      case 0x72: case 0x73: case 0x74: case 0x75: case 0x76: case 0x77:
      case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D:
      case 0x7E: case 0x7F:
        target[j++] = byte;
        continue;
      case 0xC2: case 0xC3: case 0xC4: case 0xC5: case 0xC6: case 0xC7:
      case 0xC8: case 0xC9: case 0xCA: case 0xCB: case 0xCC: case 0xCD:
      case 0xCE: case 0xCF: case 0xD0: case 0xD1: case 0xD2: case 0xD3:
      case 0xD4: case 0xD5: case 0xD6: case 0xD7: case 0xD8: case 0xD9:
      case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF:
        if (i < l) {
          const c1 = cont(buf[i]);
          if (c1 === 0x40) break;
          i++;
          const cp = (byte & 0b11111) << 6 | c1;
          if (cp < 0x80) break;
          target[j++] = cp;
          continue;
        }
        break;
      case 0xE0: case 0xE1: case 0xE2: case 0xE3: case 0xE4: case 0xE5:
      case 0xE6: case 0xE7: case 0xE8: case 0xE9: case 0xEA: case 0xEB:
      case 0xEC: case 0xED: case 0xEE: case 0xEF:
        if (i < l) {
          const c1 = cont(buf[i]);
          if (c1 === 0x40) break;

          if (++i < l) {
            const c2 = cont(buf[i]);
            if (c2 === 0x40) break;
            i++;
            const cp = (byte & 0b1111) << 12 | c1 << 6 | c2;
            if (cp < 0x800) break;
            target[j++] = cp;
            continue;
          }
        }
        break;
      case 0xF0: case 0xF1: case 0xF2: case 0xF3: case 0xF4:
        if (i < l) {
          const c1 = cont(buf[i]);
          if (c1 === 0x40) break;

          if (++i < l) {
            const c2 = cont(buf[i]);
            if (c2 === 0x40) break;

            if (++i < l) {
              const c3 = cont(buf[i]);
              if (c3 === 0x40) break;
              i++;
              const cp = (byte & 0b111) << 18 | c1 << 12 | c2 << 6 | c3;
              if (cp < 0x10000 || cp > 0x10FFFF) break;
              target[j++] = cp;
              continue;
            }
          }
        }
        break;
    }

    target[j++] = 0xFFFD;
  }

  return target.subarray(Number(target[0] === 0xFEFF), j);
};

const COMMAS    = /\s*,\s*/g;
const SEMICOLON = /\s*;/;

const canAccept = (accept, type) => {
  if (accept.startsWith('*')) return true;

  const typeCat = type.slice(0, type.indexOf('/'));

  for (const entry of accept.split(COMMAS)) {
    const [ acceptable ] = entry.split(SEMICOLON);

    if (acceptable === type)
      return true;
    if (acceptable.endsWith('/*') && acceptable.slice(0, -2) === typeCat)
      return true;
  }

  return false;
};

const conditionUnchanged = (headers, asset, lastModifiedDate) => {
  const { 'if-modified-since': date, 'if-none-match': matches } = headers;

  if (matches) {
    for (const match of parseIfMatch(matches)) {
      if (match !== undefined && match.etag === asset.etag) {
        return true;
      }
    }
  } else if (date && Date.parse(date) >= lastModifiedDate) {
    return true;
  }

  return false;
};

const conditionsUnsatisfied = (headers, asset, lastModifiedDate) => {
  const { 'if-match': matches, 'if-unmodified-since': date } = headers;

  if (matches) {
    for (const match of parseIfMatch(matches)) {
      if (match !== undefined && !match.weak && match.etag === asset.etag) {
        return false;
      }
    }
  } else if (!date || Date.parse(date) >= lastModifiedDate) {
    return false;
  }

  return true;
};

// The if-match and if-none-match headers have a simple regular grammar. I was
// surprised to find that common tools in the node ecosystem don’t seem to
// really parse these headers according to spec — maybe it’s to be forgiving,
// but I’d rather just implement the real grammar. We’ll return anything up to
// the first invalid bit, anyway.

function * parseEntityTag(str, cps, weak, i, j=i-1) {
  REQUIRED_ENTITY_TAG: {
    while (i < cps.length) {
      switch (cps[i++]) {
        case 0x22:
          yield { etag: str.slice(j, i), weak };
          weak = false;
          break REQUIRED_ENTITY_TAG;
        case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x05:
        case 0x06: case 0x07: case 0x09: case 0x0A: case 0x0B: case 0x0C:
        case 0x0D: case 0x0E: case 0x0F: case 0x10: case 0x11: case 0x12:
        case 0x13: case 0x14: case 0x15: case 0x16: case 0x17: case 0x19:
        case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E: case 0x1F:
        case 0x20: case 0x7F:
          return;
        default:
          continue;
      }
    }

    return;
  }

  if (i === cps.length) return;

  switch (cps[i++]) {
    case 0x09:
    case 0x20:
    case 0x2C:
      break;
    default:
      return;
  }

  COMMAS: while (i < cps.length) {
    switch (cps[i++]) {
      case 0x09:
      case 0x20:
      case 0x2C:
        continue;
      case 0x22:
        break COMMAS;
      case 0x57:
        if (i + 1 < cps.length && cps[i++] === 0x2F && cps[i++] === 0x22) {
          weak = true;
          break COMMAS;
        }
        return;
      default:
        return;
    }
  }

  yield * parseEntityTag(str, cps, weak, i);
}

function * parseIfMatch(str) {
  const cps = Array.from(str).map(char => char.codePointAt(0));

  let i = 0;
  let weak = false;

  FIRST_DISJUNCT: switch (cps[i++]) {
    case 0x22:
      break;
    case 0x2A:
      if (cps.length === 1) yield;
      return;
    case 0x57:
      if (i + 1 < cps.length && cps[i++] === 0x2F && cps[i++] === 0x22) {
        weak = true;
        break FIRST_DISJUNCT;
      }
      return;
    case 0x2C:
      while (i < cps.length) {
        switch (cps[i++]) {
          case 0x09:
          case 0x20:
          case 0x2C: continue;
          case 0x22: break FIRST_DISJUNCT;
          default: return;
        }
      }
      return;
    default:
      return;
  }

  yield * parseEntityTag(str, cps, weak, i);
};

module.exports = {
  canAccept,
  conditionUnchanged,
  conditionsUnsatisfied
};

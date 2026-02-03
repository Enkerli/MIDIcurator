import { describe, it, expect } from 'vitest';
import {
  pcsToBinary,
  binaryToDecimal,
  pcsToDecimal,
  rotatePcs,
  rootName,
  rootNameSharp,
  rootNameFlat,
  lookupByDecimal,
  getAllQualities,
  dictionarySize,
} from '../chord-dictionary';

describe('pcsToBinary', () => {
  it('C major triad → 100010010000', () => {
    expect(pcsToBinary([0, 4, 7])).toBe('100010010000');
  });

  it('empty set → 000000000000', () => {
    expect(pcsToBinary([])).toBe('000000000000');
  });

  it('all 12 pitch classes → 111111111111', () => {
    expect(pcsToBinary([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('111111111111');
  });

  it('handles duplicates', () => {
    expect(pcsToBinary([0, 0, 4, 4, 7])).toBe('100010010000');
  });
});

describe('binaryToDecimal', () => {
  it('C major triad binary → 2192', () => {
    expect(binaryToDecimal('100010010000')).toBe(2192);
  });

  it('all zeros → 0', () => {
    expect(binaryToDecimal('000000000000')).toBe(0);
  });
});

describe('pcsToDecimal', () => {
  it('C major triad → 2192', () => {
    expect(pcsToDecimal([0, 4, 7])).toBe(2192);
  });

  it('C minor triad → 2320', () => {
    expect(pcsToDecimal([0, 3, 7])).toBe(2320);
  });

  it('C dominant seventh → 2194', () => {
    expect(pcsToDecimal([0, 4, 7, 10])).toBe(2194);
  });
});

describe('rotatePcs', () => {
  it('rotating [0,4,7] by root=0 gives [0,4,7]', () => {
    expect(rotatePcs([0, 4, 7], 0)).toEqual([0, 4, 7]);
  });

  it('rotating [2,6,9] by root=2 gives [0,4,7]', () => {
    // D major = D(2), F#(6), A(9) → rotated to root = [0,4,7]
    expect(rotatePcs([2, 6, 9], 2)).toEqual([0, 4, 7]);
  });

  it('rotating [7,11,2] by root=7 gives [0,4,7]', () => {
    // G major = G(7), B(11), D(2) → rotated to root = [0,4,7]
    expect(rotatePcs([7, 11, 2], 7)).toEqual([0, 4, 7]);
  });

  it('handles wrap-around correctly', () => {
    // Eb minor = Eb(3), Gb(6), Bb(10) → rotated by root=3 = [0,3,7]
    expect(rotatePcs([3, 6, 10], 3)).toEqual([0, 3, 7]);
  });
});

describe('rootName', () => {
  it('0 → C', () => expect(rootName(0)).toBe('C'));
  it('1 → C♯', () => expect(rootName(1)).toBe('C♯'));
  it('3 → E♭', () => expect(rootName(3)).toBe('E♭'));
  it('6 → F♯', () => expect(rootName(6)).toBe('F♯'));
  it('11 → B', () => expect(rootName(11)).toBe('B'));
});

describe('rootNameSharp / rootNameFlat', () => {
  it('sharp spellings', () => {
    expect(rootNameSharp(1)).toBe('C♯');
    expect(rootNameSharp(3)).toBe('D♯');
    expect(rootNameSharp(6)).toBe('F♯');
  });

  it('flat spellings', () => {
    expect(rootNameFlat(1)).toBe('D♭');
    expect(rootNameFlat(3)).toBe('E♭');
    expect(rootNameFlat(6)).toBe('G♭');
  });
});

describe('lookupByDecimal', () => {
  it('finds major triad', () => {
    const q = lookupByDecimal(2192);
    expect(q).toBeDefined();
    expect(q!.key).toBe('maj');
    expect(q!.fullName).toBe('major triad');
  });

  it('finds minor seventh', () => {
    const q = lookupByDecimal(2322);
    expect(q).toBeDefined();
    expect(q!.key).toBe('min7');
  });

  it('finds dominant seventh', () => {
    const q = lookupByDecimal(2194);
    expect(q).toBeDefined();
    expect(q!.key).toBe('7');
  });

  it('returns undefined for unknown decimal', () => {
    expect(lookupByDecimal(9999)).toBeUndefined();
  });
});

describe('getAllQualities', () => {
  it('returns all 104 qualities', () => {
    expect(getAllQualities().length).toBe(104);
  });

  it('each quality has required fields', () => {
    for (const q of getAllQualities()) {
      expect(q.key).toBeTruthy();
      expect(q.fullName).toBeTruthy();
      expect(typeof q.displayName).toBe('string');
      expect(q.pcs.length).toBeGreaterThanOrEqual(2);
      expect(q.binary).toHaveLength(12);
      expect(q.decimal).toBeGreaterThan(0);
      expect(q.intervals.length).toBe(q.pcs.length);
    }
  });
});

describe('dictionarySize', () => {
  it('returns 104', () => {
    expect(dictionarySize()).toBe(104);
  });
});

describe('decimal consistency', () => {
  it('all qualities have consistent binary ↔ decimal', () => {
    for (const q of getAllQualities()) {
      const computedDecimal = binaryToDecimal(q.binary);
      expect(computedDecimal).toBe(q.decimal);
    }
  });

  it('all qualities have consistent pcs ↔ binary', () => {
    for (const q of getAllQualities()) {
      const computedBinary = pcsToBinary(q.pcs);
      expect(computedBinary).toBe(q.binary);
    }
  });
});

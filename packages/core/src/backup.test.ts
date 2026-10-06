import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  buildBackupFile,
  isDuplicate,
  mergeBackup,
  parseBackup,
  replaceBackup,
  serializeBackup,
} from './backup';
import type { BackupFile, Rule } from './types';

const EXPORTED_AT = '2026-09-29T10:00:00.000Z';

const RULES: Rule[] = [
  {
    id: 'r1',
    kind: 'block',
    pattern: 'single',
    number: '+6281234567890',
    label: 'Spam',
    enabled: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'r2',
    kind: 'allow',
    pattern: 'prefix',
    number: '+62812',
    label: 'Work',
    enabled: true,
    createdAt: '2026-09-02T00:00:00.000Z',
  },
  {
    id: 'r3',
    kind: 'block',
    pattern: 'prefix',
    number: '+628123',
    enabled: true,
    createdAt: '2026-09-03T00:00:00.000Z',
  },
  {
    id: 'r4',
    kind: 'block',
    pattern: 'interval',
    number: '+62812345678',
    end: '+62812345680',
    enabled: true,
    createdAt: '2026-09-04T00:00:00.000Z',
  },
];

/** Rule ids, one per call, so a test can name what a Restore created. */
function ids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `new-${next}`;
  };
}

describe('backupFileName', () => {
  it('names the file after the day it was written', () => {
    expect(backupFileName(new Date(2026, 8, 29))).toBe('call-blocker-backup-2026-09-29.json');
    expect(backupFileName(new Date(2026, 0, 5))).toBe('call-blocker-backup-2026-01-05.json');
  });
});

describe('buildBackupFile', () => {
  it('holds the Block rules and their Labels, and no Allow rules', () => {
    expect(buildBackupFile(RULES, EXPORTED_AT)).toEqual({
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      rules: [
        { pattern: 'single', number: '+6281234567890', label: 'Spam' },
        { pattern: 'prefix', number: '+628123' },
        { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
      ],
    });
  });
});

describe('serializeBackup', () => {
  it('writes a fixed key order and a closing newline', () => {
    const file = buildBackupFile(RULES, EXPORTED_AT);
    expect(serializeBackup(file)).toBe(
      [
        '{',
        '  "schemaVersion": 1,',
        `  "exportedAt": "${EXPORTED_AT}",`,
        '  "rules": [',
        '    {',
        '      "pattern": "single",',
        '      "number": "+6281234567890",',
        '      "label": "Spam"',
        '    },',
        '    {',
        '      "pattern": "prefix",',
        '      "number": "+628123"',
        '    },',
        '    {',
        '      "pattern": "interval",',
        '      "number": "+62812345678",',
        '      "end": "+62812345680"',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('does not care what order the keys of the given object came in', () => {
    const keysReversed: BackupFile = {
      rules: [{ label: 'Spam', number: '+6281234567890', pattern: 'single' }],
      exportedAt: EXPORTED_AT,
      schemaVersion: 1,
    };
    expect(serializeBackup(keysReversed)).toBe(
      serializeBackup(buildBackupFile([RULES[0] as Rule], EXPORTED_AT)),
    );
  });

  it('writes a disabled Rule as enabled: false and leaves enabled Rules bare', () => {
    const off: Rule[] = [{ ...(RULES[0] as Rule), enabled: false }];
    expect(buildBackupFile(off, EXPORTED_AT).rules).toEqual([
      { pattern: 'single', number: '+6281234567890', label: 'Spam', enabled: false },
    ]);
    expect(serializeBackup(buildBackupFile(off, EXPORTED_AT))).toContain('"enabled": false');
    expect(serializeBackup(buildBackupFile(RULES, EXPORTED_AT))).not.toContain('"enabled"');
  });
});

describe('parseBackup', () => {
  it('reads back what serializeBackup wrote', () => {
    const file = buildBackupFile(RULES, EXPORTED_AT);
    expect(parseBackup(serializeBackup(file))).toEqual({ ok: true, file });
  });

  it('turns down text that is not JSON', () => {
    const result = parseBackup('not a backup file');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/not valid JSON/);
  });

  it('turns down another version', () => {
    const result = parseBackup(JSON.stringify({ schemaVersion: 2, exportedAt: EXPORTED_AT, rules: [] }));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('version 2');
  });

  it('turns down a file with no rules list', () => {
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, exportedAt: EXPORTED_AT }))).toMatchObject({
      ok: false,
      message: 'This backup file has no rules list.',
    });
  });

  it('turns down an unknown pattern, naming the rule', () => {
    const result = parseBackup(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [{ pattern: 'single', number: '+6281234567890' }, { pattern: 'regex', number: '+62812' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('Rule 2');
    expect(result.ok ? '' : result.message).toContain('regex');
  });

  it('turns down a number that is not + and digits, naming the rule', () => {
    const result = parseBackup(
      JSON.stringify({ schemaVersion: 1, exportedAt: EXPORTED_AT, rules: [{ pattern: 'single', number: '08123456789' }] }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.message).toContain('Rule 1');
  });

  it('turns down an Interval with no end, naming the rule', () => {
    const result = parseBackup(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [
          { pattern: 'single', number: '+6281234567890' },
          { pattern: 'prefix', number: '+628123' },
          { pattern: 'interval', number: '+62812345678' },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.message).toContain('Rule 3');
  });

  it('turns down a rule that is not an object', () => {
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, exportedAt: EXPORTED_AT, rules: ['+62812'] }))).toMatchObject({
      ok: false,
    });
  });

  it('keeps a Label even when it holds commas', () => {
    const result = parseBackup(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [{ pattern: 'single', number: '+6281234567890', label: 'spam, calls, and texts' }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      file: {
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [{ pattern: 'single', number: '+6281234567890', label: 'spam, calls, and texts' }],
      },
    });
  });

  it('reads a disabled Rule back, and leaves an enabled one bare', () => {
    const result = parseBackup(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [
          { pattern: 'prefix', number: '+628123' },
          { pattern: 'single', number: '+6281234567890', enabled: false },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      file: {
        schemaVersion: 1,
        exportedAt: EXPORTED_AT,
        rules: [
          { pattern: 'prefix', number: '+628123' },
          { pattern: 'single', number: '+6281234567890', enabled: false },
        ],
      },
    });
  });
});

describe('isDuplicate', () => {
  it('matches the same Number pattern and the same Canonical value', () => {
    expect(
      isDuplicate(
        { pattern: 'single', number: '+6281234567890' },
        { pattern: 'single', number: '+6281234567890' },
      ),
    ).toBe(true);
    expect(
      isDuplicate({ pattern: 'prefix', number: '+628123' }, { pattern: 'prefix', number: '+628124' }),
    ).toBe(false);
    expect(isDuplicate({ pattern: 'single', number: '+62812' }, { pattern: 'prefix', number: '+62812' })).toBe(false);
  });

  it('compares both ends of an Interval', () => {
    expect(
      isDuplicate(
        { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
        { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
      ),
    ).toBe(true);
    expect(
      isDuplicate(
        { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
        { pattern: 'interval', number: '+62812345678', end: '+62812345690' },
      ),
    ).toBe(false);
  });
});

describe('mergeBackup', () => {
  const local: Rule[] = [
    {
      id: 'local',
      kind: 'block',
      pattern: 'single',
      number: '+6281234567890',
      label: 'Mine',
      enabled: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'allow-1',
      kind: 'allow',
      pattern: 'prefix',
      number: '+62812',
      enabled: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  const file: BackupFile = {
    schemaVersion: 1,
    exportedAt: EXPORTED_AT,
    rules: [
      { pattern: 'single', number: '+6281234567890', label: 'From the file' },
      { pattern: 'prefix', number: '+628123' },
      { pattern: 'prefix', number: '+628123', label: 'Twice in the file' },
      { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
    ],
  };

  it('appends the rules it does not hold, in file order', () => {
    const merged = mergeBackup(local, file, EXPORTED_AT, ids());
    expect(merged.rules).toEqual([
      local[0],
      local[1],
      { id: 'new-1', kind: 'block', pattern: 'prefix', number: '+628123', enabled: true, createdAt: EXPORTED_AT },
      {
        id: 'new-2',
        kind: 'block',
        pattern: 'interval',
        number: '+62812345678',
        end: '+62812345680',
        enabled: true,
        createdAt: EXPORTED_AT,
      },
    ]);
  });

  it('counts the duplicates, the file’s own included, and keeps the local Rule', () => {
    const merged = mergeBackup(local, file, EXPORTED_AT, ids());
    expect(merged.imported).toBe(2);
    expect(merged.duplicates).toBe(2);
    expect(merged.rules[0]).toMatchObject({ id: 'local', label: 'Mine' });
  });
});

describe('replaceBackup', () => {
  const file: BackupFile = {
    schemaVersion: 1,
    exportedAt: EXPORTED_AT,
    rules: [
      { pattern: 'single', number: '+6281234567890', label: 'Spam' },
      { pattern: 'prefix', number: '+628123' },
      { pattern: 'interval', number: '+62812345678', end: '+62812345680' },
    ],
  };

  it('makes the Block list exactly the file’s rules, so Allow rules are gone', () => {
    const replaced = replaceBackup(file, EXPORTED_AT, ids());
    expect(replaced.imported).toBe(3);
    expect(replaced.rules).toEqual([
      {
        id: 'new-1',
        kind: 'block',
        pattern: 'single',
        number: '+6281234567890',
        label: 'Spam',
        enabled: true,
        createdAt: EXPORTED_AT,
      },
      { id: 'new-2', kind: 'block', pattern: 'prefix', number: '+628123', enabled: true, createdAt: EXPORTED_AT },
      {
        id: 'new-3',
        kind: 'block',
        pattern: 'interval',
        number: '+62812345678',
        end: '+62812345680',
        enabled: true,
        createdAt: EXPORTED_AT,
      },
    ]);
    expect(replaced.rules.every((rule) => rule.kind === 'block')).toBe(true);
  });

  it('brings a disabled Rule back disabled', () => {
    const withOff: BackupFile = {
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      rules: [{ pattern: 'prefix', number: '+628123', enabled: false }],
    };
    const replaced = replaceBackup(withOff, EXPORTED_AT, ids());
    expect(replaced.rules).toEqual([
      {
        id: 'new-1',
        kind: 'block',
        pattern: 'prefix',
        number: '+628123',
        enabled: false,
        createdAt: EXPORTED_AT,
      },
    ]);
  });
});

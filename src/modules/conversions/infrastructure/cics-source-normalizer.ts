/**
 * Rewrites EXEC CICS blocks in fixed-format COBOL into the narrow dialect tool2java's
 * JavaCC parser accepts, so CICS programs convert at all instead of dying on the first
 * ParseException.
 *
 * tool2java's grammar (see its syntaxtree/*CICS.java javadoc) is much stricter than real
 * CICS:
 *   - every option must appear in one fixed order per command;
 *   - option arguments must be a single word or literal (no `A OF B`, no `LENGTH OF X`,
 *     no subscripts);
 *   - many options and commands simply do not exist (RESP, RESP2, NOHANDLE, RIDFLD on
 *     READ, STARTBR, READNEXT, WRITE, REWRITE, ASKTIME, FORMATTIME, SYNCPOINT, ABEND, ...).
 *
 * The rewrite is lossy by necessity. Every change is recorded in `NormalizationChange` and
 * the original block stays in the source as a comment, so the generated Java can be
 * reviewed against it. Semantics that are lost:
 *   - RESP/RESP2/NOHANDLE are dropped: the response field is never set, so it keeps its
 *     initial value. DFHRESP(...) becomes the numeric EIBRESP code, so `WHEN DFHRESP(NORMAL)`
 *     still compiles, but error branches that depend on RESP are no longer taken.
 *   - LENGTH(LENGTH OF X) / KEYLENGTH(LENGTH OF X) are dropped (the length follows from the area).
 *   - READ's RIDFLD is dropped because tool2java's READ has no key option.
 *   - Unsupported commands become CONTINUE (no-ops), e.g. STARTBR, READNEXT, WRITE, REWRITE,
 *     ASKTIME, FORMATTIME, SYNCPOINT, ABEND, RETRIEVE, ASSIGN, INQUIRE PROGRAM, bare RECEIVE.
 *   - CURSOR(n) on SEND MAP/TEXT becomes plain CURSOR (the explicit position is lost).
 *   - EIB fields come from a stub DFHEIBLK in WORKING-STORAGE with zero/space initial
 *     values (so EIBCALEN = 0 means "first entry" every time).
 */

export type NormalizationChangeKind =
  | 'DROPPED_OPTION'
  | 'REORDERED'
  | 'HOISTED_ARGUMENT'
  | 'REPLACED_WITH_CONTINUE'
  | 'DFHRESP_INLINED'
  | 'STUB_INJECTED'
  | 'EMPTY_SECTION_REMOVED'
  | 'SEPARATOR_COMMA_REMOVED'
  | 'EMPTY_SENTENCE_REMOVED'
  | 'DEFAULT_MADE_EXPLICIT';

export interface NormalizationChange {
  kind: NormalizationChangeKind;
  /** 1-based line in the original source. */
  line: number;
  detail: string;
}

export interface NormalizationResult {
  source: string;
  changes: NormalizationChange[];
  /** True when the program needs the generated ALSMCICS copybook (EIB block / temps). */
  needsSupportCopybook: boolean;
  /** Working-storage temps (name -> PIC) the rewritten statements MOVE arguments into. */
  hoists: Map<string, string>;
}

type ArgKind = 'none' | 'wl' | 'w' | 'wi';

interface OptSpec {
  name: string;
  arg: ArgKind;
  required?: boolean;
  /** Working-storage temp used when the argument is too complex for the grammar. */
  hoistPic?: string;
}

interface CommandSpec {
  /** Leading keywords emitted verbatim (e.g. SEND MAP is SEND + the MAP option). */
  prefix: string[];
  /** Exactly one of these flags is required right after the prefix (READQ TS|TD ...). */
  flagChoice?: { names: string[]; fallback: string };
  options: OptSpec[];
}

const NAME8 = 'X(8)';
const opt = (name: string, arg: ArgKind = 'wl', extra: Partial<OptSpec> = {}): OptSpec => ({
  name,
  arg,
  ...extra,
});
const flag = (name: string): OptSpec => ({ name, arg: 'none' });

/** Option order mirrors tool2java's grammar exactly; anything not listed is dropped. */
const COMMANDS: Record<string, CommandSpec> = {
  SEND_MAP: {
    prefix: ['SEND'],
    options: [
      opt('MAP', 'wl', { required: true, hoistPic: NAME8 }),
      opt('MAPSET', 'wl', { required: true, hoistPic: NAME8 }),
      opt('FROM'),
      opt('LENGTH'),
      flag('DATAONLY'),
      flag('MAPONLY'),
      flag('CURSOR'),
      flag('FORMFEED'),
      flag('ERASE'),
      flag('ERASEAUP'),
      flag('PRINT'),
      flag('FREEKB'),
      flag('ALARM'),
      flag('FRSET'),
    ],
  },
  SEND_TEXT: {
    prefix: ['SEND', 'TEXT'],
    options: [
      opt('FROM'),
      opt('LENGTH'),
      flag('CURSOR'),
      flag('FORMFEED'),
      flag('ERASE'),
      flag('PRINT'),
      flag('FREEKB'),
      flag('ALARM'),
      flag('NLEOM'),
    ],
  },
  SEND_CONTROL: {
    prefix: ['SEND', 'CONTROL'],
    options: [
      opt('CURSOR'),
      flag('ERASE'),
      flag('ERASEAUP'),
      flag('PRINT'),
      flag('FREEKB'),
      flag('ALARM'),
      flag('FRSET'),
    ],
  },
  RECEIVE_MAP: {
    prefix: ['RECEIVE'],
    options: [
      opt('MAP', 'wl', { required: true, hoistPic: NAME8 }),
      opt('MAPSET'),
      opt('INTO'),
      opt('SET'),
      flag('TERMINAL'),
    ],
  },
  READQ: {
    prefix: ['READQ'],
    flagChoice: { names: ['TS', 'TD'], fallback: 'TS' },
    options: [
      opt('QUEUE', 'w', { hoistPic: 'X(16)' }),
      opt('INTO', 'w'),
      opt('LENGTH', 'w'),
      opt('NUMITEMS', 'w'),
      opt('SYSID', 'w'),
    ],
  },
  WRITEQ: {
    prefix: ['WRITEQ'],
    flagChoice: { names: ['TD', 'TS'], fallback: 'TS' },
    options: [
      opt('QUEUE', 'w', { hoistPic: 'X(16)' }),
      opt('FROM', 'w'),
      opt('LENGTH', 'wi'),
      opt('SYSID', 'w'),
    ],
  },
  DELETEQ: {
    prefix: ['DELETEQ'],
    flagChoice: { names: ['TS', 'TD'], fallback: 'TS' },
    options: [opt('QUEUE', 'w', { hoistPic: 'X(16)' }), opt('SYSID', 'w')],
  },
  RETURN: {
    prefix: ['RETURN'],
    options: [
      opt('TRANSID', 'wl', { hoistPic: 'X(4)' }),
      opt('COMMAREA'),
      flag('IMMEDIATE'),
      opt('LENGTH'),
    ],
  },
  XCTL: {
    prefix: ['XCTL'],
    options: [opt('PROGRAM', 'wl', { required: true, hoistPic: NAME8 }), opt('COMMAREA')],
  },
  LINK: {
    prefix: ['LINK'],
    options: [
      opt('PROGRAM', 'wl', { required: true, hoistPic: NAME8 }),
      opt('COMMAREA', 'w'),
      opt('LENGTH'),
      opt('DATALENGTH'),
      opt('SYSID'),
      flag('SYNCONRETURN'),
      opt('TRANSID'),
    ],
  },
  READ: {
    prefix: ['READ'],
    options: [
      opt('FILE', 'wl', { required: true, hoistPic: NAME8 }),
      flag('UNCOMMITTED'),
      flag('UPDATE'),
      opt('INTO'),
      opt('SET'),
      opt('KEYLENGTH'),
      opt('SYSID'),
      opt('LENGTH'),
      flag('RBA'),
      flag('RRN'),
      flag('EQUAL'),
      flag('GTEQ'),
      flag('NOSUSPEND'),
    ],
  },
  READPREV: {
    prefix: ['READPREV'],
    options: [
      opt('FILE', 'wl', { required: true, hoistPic: NAME8 }),
      opt('INTO'),
      opt('SET'),
      opt('RIDFLD'),
      flag('UPDATE'),
      opt('KEYLENGTH'),
      opt('REQID'),
      opt('SYSID'),
      opt('LENGTH'),
      flag('NOSUSPEND'),
    ],
  },
  DELETE: {
    prefix: ['DELETE'],
    options: [
      opt('FILE', 'wl', { required: true, hoistPic: NAME8 }),
      opt('RIDFLD'),
      opt('KEYLENGTH'),
      opt('NUMREC'),
      opt('SYSID'),
      flag('NOSUSPEND'),
    ],
  },
  ENDBR: {
    prefix: ['ENDBR'],
    options: [opt('FILE', 'wl', { required: true, hoistPic: NAME8 }), opt('REQID'), opt('SYSID')],
  },
  START: {
    prefix: ['START'],
    options: [
      opt('TRANSID', 'wl', { required: true, hoistPic: 'X(4)' }),
      opt('INTERVAL'),
      opt('FROM'),
      opt('LENGTH'),
    ],
  },
  HANDLE_AID: {
    prefix: ['HANDLE', 'AID'],
    options: [opt('PA1'), opt('PA2'), opt('PF1'), opt('ENTER'), opt('CLEAR'), opt('ANYKEY')],
  },
  HANDLE_CONDITION: {
    prefix: ['HANDLE', 'CONDITION'],
    options: [opt('QIDERR')],
  },
};

/** Option spellings CICS accepts that tool2java only knows under another name. */
const OPTION_ALIASES: Record<string, string> = { DATASET: 'FILE', QNAME: 'QUEUE' };

/** EIBRESP values for DFHRESP(...), from the CICS Application Programming Reference. */
export const DFHRESP_CODES: Record<string, number> = {
  NORMAL: 0,
  ERROR: 1,
  RDATT: 2,
  WRBRK: 3,
  EOF: 4,
  EODS: 5,
  EOC: 6,
  INBFMH: 7,
  ENDINPT: 8,
  NONVAL: 9,
  NOSTART: 10,
  TERMIDERR: 11,
  FILENOTFOUND: 12,
  DSIDERR: 12,
  NOTFND: 13,
  DUPREC: 14,
  DUPKEY: 15,
  INVREQ: 16,
  IOERR: 17,
  NOSPACE: 18,
  NOTOPEN: 19,
  ENDFILE: 20,
  ILLOGIC: 21,
  LENGERR: 22,
  QZERO: 23,
  SIGNAL: 24,
  QBUSY: 25,
  ITEMERR: 26,
  PGMIDERR: 27,
  TRANSIDERR: 28,
  ENDDATA: 29,
  INVTSREQ: 30,
  EXPIRED: 31,
  RETPAGE: 32,
  RTEFAIL: 33,
  RTESOME: 34,
  TSIOERR: 35,
  MAPFAIL: 36,
  INVERRTERM: 37,
  INVMPSZ: 38,
  IGREQID: 39,
  OVERFLOW: 40,
  INVLDC: 41,
  NOSTG: 42,
  JIDERR: 43,
  QIDERR: 44,
  NOJBUFSP: 45,
  DSSTAT: 46,
  SELNERR: 47,
  FUNCERR: 48,
  UNEXPIN: 49,
  NOPASSBKRD: 50,
  NOPASSBKWR: 51,
  SYSIDERR: 53,
  ISCINVREQ: 54,
  ENQBUSY: 55,
  ENVDEFERR: 56,
  IGREQCD: 57,
  SESSIONERR: 58,
  SYSBUSY: 59,
  SESSBUSY: 60,
  NOTALLOC: 61,
  CBIDERR: 62,
  INVEXITREQ: 63,
  INVPARTNSET: 64,
  INVPARTN: 65,
  PARTNFAIL: 66,
  USERIDERR: 69,
  NOTAUTH: 70,
  VOLIDERR: 71,
  SUPPRESSED: 72,
  RESIDERR: 75,
  NOSPOOL: 80,
  TERMERR: 81,
  ROLLEDBACK: 82,
  END: 83,
  DISABLED: 84,
  ALLOCERR: 85,
  STRELERR: 86,
  OPENERR: 87,
  SPOLBUSY: 88,
  SPOLERR: 89,
  NODEIDERR: 90,
  TASKIDERR: 91,
  TCIDERR: 92,
  DSNNOTFOUND: 93,
  LOADING: 94,
  MODELIDERR: 95,
  OUTDESCRERR: 96,
  PARTNERIDERR: 97,
  PROFILEIDERR: 98,
  NETNAMEIDERR: 99,
  LOCKED: 100,
  RECORDBUSY: 101,
  UOWNOTFOUND: 102,
  UOWLNOTFOUND: 103,
  LINKABEND: 104,
  CHANGED: 105,
  PROCESSBUSY: 106,
  ACTIVITYBUSY: 107,
  PROCESSERR: 108,
  ACTIVITYERR: 109,
  CONTAINERERR: 110,
  EVENTERR: 111,
  TOKENERR: 112,
  NOTFINISHED: 113,
  POOLERR: 114,
  TIMERERR: 115,
  SYMBOLERR: 116,
  TEMPLATERR: 117,
  NOTSUPERUSER: 118,
  CSDERR: 119,
  DUPRES: 120,
  RESUNAVAIL: 121,
  CHANNELERR: 122,
  CCSIDERR: 123,
  TIMEDOUT: 124,
  CODEPAGEERR: 125,
  INCOMPLETE: 126,
  APPNOTFOUND: 127,
  BUSY: 128,
};

export const SUPPORT_COPYBOOK_NAME = 'ALSMCICS';

const CODE_START = 7;
const CODE_END = 72;
const WORD_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const LITERAL_RE = /^(?:'[^']*'|"[^"]*"|[+-]?\d+(?:\.\d+)?)$/;

interface ParsedOption {
  name: string;
  arg?: string;
}

interface Hoist {
  temp: string;
  pic: string;
  expr: string;
}

function isComment(line: string): boolean {
  return line.length > 6 && (line[6] === '*' || line[6] === '/');
}

function codeArea(line: string): string {
  return isComment(line) ? '' : line.slice(CODE_START, CODE_END);
}

/** Splits the inside of an EXEC CICS block into `NAME` / `NAME(arg)` options, keeping
 * quoted literals and nested parentheses intact. */
function parseOptions(body: string): ParsedOption[] {
  const result: ParsedOption[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    const nameMatch = /^[A-Za-z0-9][A-Za-z0-9-]*/.exec(body.slice(i));
    if (!nameMatch) {
      i++;
      continue;
    }
    const name = nameMatch[0].toUpperCase();
    i += nameMatch[0].length;
    let j = i;
    while (j < body.length && /\s/.test(body[j])) j++;
    if (body[j] !== '(') {
      result.push({ name });
      continue;
    }
    let depth = 0;
    let quote: string | null = null;
    let k = j;
    for (; k < body.length; k++) {
      const ch = body[k];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) break;
    }
    result.push({
      name,
      arg: body
        .slice(j + 1, k)
        .replace(/\s+/g, ' ')
        .trim(),
    });
    i = k + 1;
  }
  return result;
}

function pickCommand(options: ParsedOption[]): string | null {
  const names = new Set(options.map((o) => o.name));
  const first = options[0]?.name;
  switch (first) {
    case 'SEND':
      if (names.has('MAP')) return 'SEND_MAP';
      if (names.has('CONTROL')) return 'SEND_CONTROL';
      // Bare SEND (terminal write) is closest to SEND TEXT, which the grammar does support.
      return 'SEND_TEXT';
    case 'RECEIVE':
      return names.has('MAP') ? 'RECEIVE_MAP' : null;
    case 'READ':
    case 'READPREV':
    case 'DELETE':
    case 'ENDBR':
      return names.has('FILE') || names.has('DATASET') ? first : null;
    case 'HANDLE':
      if (names.has('AID')) return 'HANDLE_AID';
      if (names.has('CONDITION')) return 'HANDLE_CONDITION';
      return null;
    case 'READQ':
    case 'WRITEQ':
    case 'DELETEQ':
    case 'RETURN':
    case 'XCTL':
    case 'LINK':
      return first;
    case 'START':
      return names.has('TRANSID') ? 'START' : null;
    default:
      return null;
  }
}

/** Commands tool2java parses that this normalizer does not model; left untouched. */
const PASS_THROUGH = new Set(['LOAD', 'ADDRESS', 'IGNORE']);

function argAccepted(arg: string, kind: ArgKind): boolean {
  if (kind === 'none') return false;
  if (WORD_RE.test(arg)) return true;
  if (kind === 'wl') return LITERAL_RE.test(arg);
  if (kind === 'wi') return /^\d+$/.test(arg);
  return false;
}

function tempName(option: string): string {
  return `ALSM-CICS-${option}`;
}

interface RewriteOutcome {
  statement: string;
  hoists: Hoist[];
  notes: { kind: NormalizationChangeKind; detail: string }[];
  /** Statement had to become CONTINUE; no hoists apply. */
  replaced: boolean;
}

function rewriteCommand(body: string): RewriteOutcome | null {
  const parsed = parseOptions(body).map((o) => ({ ...o, name: OPTION_ALIASES[o.name] ?? o.name }));
  if (parsed.length === 0) return null;
  if (PASS_THROUGH.has(parsed[0].name)) return null;

  const commandId = pickCommand(parsed);
  const describe = parsed
    .slice(0, 2)
    .map((o) => o.name)
    .join(' ');
  if (!commandId) {
    return {
      statement: 'CONTINUE',
      hoists: [],
      notes: [
        {
          kind: 'REPLACED_WITH_CONTINUE',
          detail: `EXEC CICS ${describe} is not supported by tool2java; replaced with CONTINUE`,
        },
      ],
      replaced: true,
    };
  }

  const spec = COMMANDS[commandId];
  const consumed = new Set<string>(spec.prefix);
  const notes: RewriteOutcome['notes'] = [];
  const hoists: Hoist[] = [];
  const out: string[] = [...spec.prefix];

  if (spec.flagChoice) {
    const present = spec.flagChoice.names.find((n) => parsed.some((o) => o.name === n));
    out.push(present ?? spec.flagChoice.fallback);
    spec.flagChoice.names.forEach((n) => consumed.add(n));
  }

  const byName = new Map<string, ParsedOption>(parsed.map((o) => [o.name, o]));
  // CICS defaults RECEIVE MAP's INTO to the map name + 'I'; tool2java needs it explicit.
  if (commandId === 'RECEIVE_MAP' && !byName.has('INTO') && !byName.has('SET')) {
    const mapName = byName.get('MAP')?.arg?.replace(/^['"]|['"]$/g, '');
    if (mapName && WORD_RE.test(mapName)) {
      byName.set('INTO', { name: 'INTO', arg: `${mapName}I` });
      notes.push({
        kind: 'DEFAULT_MADE_EXPLICIT',
        detail: `implicit INTO(${mapName}I) made explicit`,
      });
    }
  }
  for (const optSpec of spec.options) {
    const found = byName.get(optSpec.name);
    let value = found;
    // CICS defaults MAPSET to the map name; tool2java requires it spelled out.
    if (!value && optSpec.name === 'MAPSET' && optSpec.required) {
      const map = byName.get('MAP');
      if (map?.arg) value = { name: 'MAPSET', arg: map.arg };
    }
    if (!value) {
      if (optSpec.required) {
        notes.push({
          kind: 'REPLACED_WITH_CONTINUE',
          detail: `EXEC CICS ${describe} is missing required ${optSpec.name}; replaced with CONTINUE`,
        });
        return { statement: 'CONTINUE', hoists: [], notes, replaced: true };
      }
      continue;
    }
    consumed.add(optSpec.name);

    if (optSpec.arg === 'none') {
      if (value.arg !== undefined) {
        notes.push({
          kind: 'DROPPED_OPTION',
          detail: `${optSpec.name}(${value.arg}) reduced to ${optSpec.name}; argument not supported`,
        });
      }
      out.push(optSpec.name);
      continue;
    }
    if (value.arg === undefined) {
      notes.push({ kind: 'DROPPED_OPTION', detail: `${optSpec.name} without an argument dropped` });
      continue;
    }
    if (argAccepted(value.arg, optSpec.arg)) {
      out.push(`${optSpec.name}(${value.arg})`);
      continue;
    }
    if (optSpec.hoistPic) {
      const temp = tempName(optSpec.name);
      hoists.push({ temp, pic: optSpec.hoistPic, expr: value.arg });
      out.push(`${optSpec.name}(${temp})`);
      notes.push({
        kind: 'HOISTED_ARGUMENT',
        detail: `${optSpec.name}(${value.arg}) moved into ${temp}`,
      });
      continue;
    }
    if (optSpec.required) {
      notes.push({
        kind: 'REPLACED_WITH_CONTINUE',
        detail: `EXEC CICS ${describe}: ${optSpec.name}(${value.arg}) cannot be expressed; replaced with CONTINUE`,
      });
      return { statement: 'CONTINUE', hoists: [], notes, replaced: true };
    }
    notes.push({
      kind: 'DROPPED_OPTION',
      detail: `${optSpec.name}(${value.arg}) dropped; tool2java only accepts a single name or literal`,
    });
  }

  for (const o of parsed) {
    if (consumed.has(o.name)) continue;
    notes.push({
      kind: 'DROPPED_OPTION',
      detail: `${o.name}${o.arg !== undefined ? `(${o.arg})` : ''} dropped; not supported by tool2java for ${spec.prefix.join(' ')}`,
    });
  }

  const sourceOrder = parsed.map((o) => o.name).filter((n) => out.some((t) => t.startsWith(n)));
  const outOrder = out.map((t) => t.replace(/\(.*$/, '')).filter((n) => sourceOrder.includes(n));
  if (sourceOrder.join(' ') !== outOrder.join(' ')) {
    notes.push({ kind: 'REORDERED', detail: 'options reordered to the order tool2java expects' });
  }

  return { statement: `EXEC CICS ${out.join(' ')}`, hoists, notes, replaced: false };
}

/** Splits text into whitespace-separated pieces without breaking quoted literals. */
function splitPreservingLiterals(text: string): string[] {
  const pieces: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current) pieces.push(current);
      current = '';
    } else current += ch;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Lays code out in fixed-format area B (cols 8-72), continuing on extra lines as needed.
 * `firstLineSlack` reserves room on the first line for text tool2java later inserts. */
function layout(text: string, indent: number, firstLineSlack = 0): string[] {
  const lines: string[] = [];
  const fullWidth = CODE_END - CODE_START;
  let width = fullWidth - firstLineSlack;
  const firstIndent = Math.max(indent, 4);
  let current = ' '.repeat(firstIndent);
  for (const piece of splitPreservingLiterals(text)) {
    const candidate = current.trim() ? `${current} ${piece}` : `${current}${piece}`;
    if (candidate.length > width && current.trim()) {
      lines.push(current);
      width = fullWidth;
      current = ' '.repeat(firstIndent + 4) + piece;
    } else current = candidate;
  }
  if (current.trim()) lines.push(current);
  return lines.map((l) => ' '.repeat(CODE_START) + l);
}

function commentOut(line: string): string {
  const padded = line.padEnd(7, ' ');
  return `${padded.slice(0, 6)}*${padded.slice(7)}`;
}

function inlineDfhresp(line: string, lineNo: number, changes: NormalizationChange[]): string {
  if (isComment(line)) return line;
  const area = line.slice(CODE_START, CODE_END);
  const replaced = area.replace(/DFHRESP\s*\(\s*([A-Z0-9]+)\s*\)/gi, (match, name: string) => {
    const code = DFHRESP_CODES[name.toUpperCase()];
    if (code === undefined) return match;
    changes.push({
      kind: 'DFHRESP_INLINED',
      line: lineNo,
      detail: `DFHRESP(${name.toUpperCase()}) -> ${code}`,
    });
    return String(code).padEnd(match.length, ' ');
  });
  return replaced === area ? line : line.slice(0, CODE_START) + replaced + line.slice(CODE_END);
}

/** tool2java rejects an INPUT-OUTPUT SECTION header with no FILE-CONTROL beneath it. */
function removeEmptyInputOutputSection(lines: string[], changes: NormalizationChange[]): void {
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*INPUT-OUTPUT\s+SECTION\s*\.\s*$/i.test(codeArea(lines[i]))) continue;
    let j = i + 1;
    while (j < lines.length && codeArea(lines[j]).trim() === '') j++;
    if (j < lines.length && /^\s*DATA\s+DIVISION\b/i.test(codeArea(lines[j]))) {
      lines[i] = commentOut(lines[i]);
      changes.push({
        kind: 'EMPTY_SECTION_REMOVED',
        line: i + 1,
        detail: 'empty INPUT-OUTPUT SECTION commented out',
      });
    }
  }
}

/** COBOL allows ',' / ';' as plain separators (`STRING A, B DELIMITED ...`); tool2java's
 * grammar does not. Outside literals a separator comma is always followed by a space, so
 * replacing it with a space keeps the columns and the meaning. */
function removeSeparatorCommas(
  line: string,
  lineNo: number,
  changes: NormalizationChange[],
): string {
  if (isComment(line)) return line;
  const area = line.slice(CODE_START, CODE_END);
  let out = '';
  let quote: string | null = null;
  let count = 0;
  for (let i = 0; i < area.length; i++) {
    const ch = area[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if ((ch === ',' || ch === ';') && (i + 1 === area.length || area[i + 1] === ' ')) {
      out += ' ';
      count++;
      continue;
    }
    out += ch;
  }
  if (count === 0) return line;
  changes.push({
    kind: 'SEPARATOR_COMMA_REMOVED',
    line: lineNo,
    detail: `${count} separator comma(s) removed`,
  });
  return line.slice(0, CODE_START) + out + line.slice(CODE_END);
}

/** A lone '.' right after a sentence that already ended with '.' is an empty sentence —
 * legal COBOL, but tool2java rejects it. */
function removeEmptySentences(lines: string[], changes: NormalizationChange[]): void {
  let previousEndsWithPeriod = false;
  for (let i = 0; i < lines.length; i++) {
    const code = codeArea(lines[i]).trim();
    if (!code) continue;
    if (code === '.' && previousEndsWithPeriod) {
      lines[i] = commentOut(lines[i]);
      changes.push({
        kind: 'EMPTY_SENTENCE_REMOVED',
        line: i + 1,
        detail: 'empty sentence (extra period) removed',
      });
      continue;
    }
    previousEndsWithPeriod = code.endsWith('.');
  }
}

export function normalizeCicsSource(source: string): NormalizationResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const original = source.split(/\r?\n/);
  const changes: NormalizationChange[] = [];
  const working = original.map((line, idx) =>
    removeSeparatorCommas(inlineDfhresp(line, idx + 1, changes), idx + 1, changes),
  );
  removeEmptyInputOutputSection(working, changes);

  // Code areas joined with '\n' so an EXEC CICS block spanning lines is one match, and a
  // stream offset maps straight back to (line, column).
  const areas = working.map(codeArea);
  const lineStart: number[] = [];
  let offset = 0;
  for (const area of areas) {
    lineStart.push(offset);
    offset += area.length + 1;
  }
  const stream = areas.join('\n');
  const locate = (pos: number) => {
    let line = lineStart.length - 1;
    while (lineStart[line] > pos) line--;
    return { line, col: pos - lineStart[line] };
  };

  const output: string[] = [];
  const hoistDecls = new Map<string, string>();
  let cursor = 0;
  const blockRe = /\bEXEC\s+CICS\b([\s\S]*?)\bEND-EXEC\b/gi;
  for (const match of stream.matchAll(blockRe)) {
    const start = locate(match.index);
    const end = locate(match.index + match[0].length);
    const rewrite = rewriteCommand(match[1]);
    if (!rewrite) continue;

    for (; cursor < start.line; cursor++) output.push(working[cursor]);

    const prefix = areas[start.line].slice(0, start.col);
    const suffix = areas[end.line].slice(end.col);
    for (let l = start.line; l <= end.line; l++) output.push(commentOut(working[l]));

    const moves = rewrite.hoists.map((h) => `MOVE ${h.expr} TO ${h.temp}`);
    rewrite.hoists.forEach((h) => hoistDecls.set(h.temp, h.pic));
    const indent = prefix.trim() ? prefix.length - prefix.trimStart().length : start.col;
    const lead = [prefix.trim(), ...moves].filter(Boolean).join(' ');
    if (lead) output.push(...layout(lead, indent));
    const tail = suffix.trim();
    if (rewrite.replaced) {
      output.push(...layout([rewrite.statement, tail].filter(Boolean).join(' '), indent));
    } else {
      // tool2java's preprocessor rewrites every "EXEC" on the EXEC CICS line to "EXEC-CICS"
      // (END-EXEC included, which then fails to parse) and the line grows by 5 columns, so
      // END-EXEC goes on its own line and the first line keeps room for that growth.
      output.push(...layout(rewrite.statement, indent, 'EXEC-CICS'.length - 'EXEC'.length));
      const endLine = `END-EXEC${tail.startsWith('.') ? tail : tail ? ` ${tail}` : ''}`;
      output.push(...layout(endLine, indent));
    }
    rewrite.notes.forEach((n) => changes.push({ ...n, line: start.line + 1 }));
    cursor = end.line + 1;
  }
  for (; cursor < working.length; cursor++) output.push(working[cursor]);
  // Runs on the rewritten text: `END-EXEC.` followed by a lone `.` only appears here.
  removeEmptySentences(output, changes);

  const usesEib = areas.some((a) => /\bEIB[A-Z0-9]+\b/i.test(a));
  const needsSupportCopybook = usesEib || hoistDecls.size > 0;
  if (needsSupportCopybook) {
    const wsIndex = output.findIndex((l) =>
      /^\s*WORKING-STORAGE\s+SECTION\s*\./i.test(codeArea(l)),
    );
    if (wsIndex >= 0) {
      output.splice(wsIndex + 1, 0, `       COPY ${SUPPORT_COPYBOOK_NAME}.`);
      changes.push({
        kind: 'STUB_INJECTED',
        line: wsIndex + 1,
        detail: `COPY ${SUPPORT_COPYBOOK_NAME} (EIB block${hoistDecls.size ? ' + hoisted temps' : ''}) injected`,
      });
    }
  }
  return { source: output.join(eol), changes, needsSupportCopybook, hoists: hoistDecls };
}

/** Working-storage support copybook: a DFHEIBLK stand-in plus any hoisted temps. */
export function buildSupportCopybook(hoists: Map<string, string>): string {
  const lines = [
    '      * Generated by ALSM: stand-in for the CICS-supplied EIB and temps',
    '      * used to pass arguments tool2java cannot accept inline.',
    '       01  DFHEIBLK.',
    '           05  EIBTIME     PIC S9(7) COMP-3 VALUE 0.',
    '           05  EIBDATE     PIC S9(7) COMP-3 VALUE 0.',
    '           05  EIBTRNID    PIC X(4) VALUE SPACES.',
    '           05  EIBTASKN    PIC S9(7) COMP-3 VALUE 0.',
    '           05  EIBTRMID    PIC X(4) VALUE SPACES.',
    '           05  EIBCPOSN    PIC S9(4) COMP VALUE 0.',
    '           05  EIBCALEN    PIC S9(4) COMP VALUE 0.',
    '           05  EIBAID      PIC X VALUE SPACE.',
    '           05  EIBFN       PIC X(2) VALUE SPACES.',
    '           05  EIBRCODE    PIC X(6) VALUE SPACES.',
    '           05  EIBDS       PIC X(8) VALUE SPACES.',
    '           05  EIBREQID    PIC X(8) VALUE SPACES.',
    '           05  EIBRSRCE    PIC X(8) VALUE SPACES.',
    '           05  EIBRESP     PIC S9(8) COMP VALUE 0.',
    '           05  EIBRESP2    PIC S9(8) COMP VALUE 0.',
  ];
  if (hoists.size > 0) {
    lines.push('       01  ALSM-CICS-TEMPS.');
    for (const [name, pic] of [...hoists.entries()].sort()) {
      lines.push(`           05  ${name} PIC ${pic}.`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Minimal DFHAID: attention-identifier constants compared against EIBAID. Values follow
 * IBM's DFHAID as far as printable characters allow; they only need to be distinct. */
export const DFHAID_STUB =
  [
    '      * Generated by ALSM: stand-in for the CICS-supplied DFHAID.',
    '       01  DFHAID.',
    '           02  DFHNULL   PIC X VALUE LOW-VALUE.',
    '           02  DFHENTER  PIC X VALUE QUOTE.',
    "           02  DFHCLEAR  PIC X VALUE '_'.",
    "           02  DFHPEN    PIC X VALUE '='.",
    "           02  DFHOPID   PIC X VALUE 'W'.",
    "           02  DFHMSRE   PIC X VALUE 'X'.",
    "           02  DFHSTRF   PIC X VALUE 'h'.",
    "           02  DFHTRIG   PIC X VALUE '\"'.",
    "           02  DFHPA1    PIC X VALUE '%'.",
    "           02  DFHPA2    PIC X VALUE '>'.",
    "           02  DFHPA3    PIC X VALUE ','.",
    ...[
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      ':',
      '#',
      '@',
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      '[',
      '.',
      '<',
    ].map((v, i) => `           02  DFHPF${String(i + 1).padEnd(5, ' ')} PIC X VALUE '${v}'.`),
  ].join('\n') + '\n';

/** Minimal DFHBMSCA: BMS attribute / color constants. Exact byte values only matter to a
 * real 3270; in converted Java they are opaque flags moved into the map's attribute fields. */
export const DFHBMSCA_STUB =
  [
    '      * Generated by ALSM: stand-in for the CICS-supplied DFHBMSCA.',
    '       01  DFHBMSCA.',
    ...(
      [
        ['DFHBMPEM', 'SPACE'],
        ['DFHBMPNL', 'SPACE'],
        ['DFHBMASK', "'0'"],
        ['DFHBMUNP', 'SPACE'],
        ['DFHBMUNN', "'&'"],
        ['DFHBMPRO', "'-'"],
        ['DFHBMBRY', "'H'"],
        ['DFHBMDAR', "'<'"],
        ['DFHBMFSE', "'A'"],
        ['DFHBMPRF', "'/'"],
        ['DFHBMASF', "'1'"],
        ['DFHBMASB', "'8'"],
        ['DFHBMEOF', 'SPACE'],
        ['DFHBMCUR', 'SPACE'],
        ['DFHBMEC', 'SPACE'],
        ['DFHBMFLG', 'SPACE'],
        ['DFHBMDET', 'HIGH-VALUE'],
        ['DFHSA', 'SPACE'],
        ['DFHCOLOR', 'SPACE'],
        ['DFHPS', 'SPACE'],
        ['DFHHLT', 'SPACE'],
        ['DFH3270', 'SPACE'],
        ['DFHVAL', "'A'"],
        ['DFHOUTLN', "'B'"],
        ['DFHBKTRN', 'SPACE'],
        ['DFHALL', 'LOW-VALUE'],
        ['DFHERROR', 'SPACE'],
        ['DFHDFT', 'HIGH-VALUE'],
        ['DFHDFCOL', 'LOW-VALUE'],
        ['DFHBLUE', "'1'"],
        ['DFHRED', "'2'"],
        ['DFHPINK', "'3'"],
        ['DFHGREEN', "'4'"],
        ['DFHTURQ', "'5'"],
        ['DFHYELLO', "'6'"],
        ['DFHNEUTR', "'7'"],
        ['DFHBASE', 'LOW-VALUE'],
        ['DFHDFHI', 'LOW-VALUE'],
        ['DFHBLINK', "'1'"],
        ['DFHREVRS', "'2'"],
        ['DFHUNDLN', "'4'"],
        ['DFHMFIL', 'SPACE'],
        ['DFHMENT', 'SPACE'],
        ['DFHMFE', 'SPACE'],
        ['DFHUNNOD', "'('"],
        ['DFHUNIMD', "'I'"],
        ['DFHUNNUM', "'J'"],
        ['DFHUNNUB', "'Q'"],
        ['DFHUNINT', "'R'"],
        ['DFHUNNON', "')'"],
        ['DFHPROTI', "'Y'"],
        ['DFHPROTN', "'%'"],
      ] as const
    ).map(([name, value]) => `           02  ${name.padEnd(9, ' ')} PIC X VALUE ${value}.`),
  ].join('\n') + '\n';

export interface BundleNormalization {
  /** File name -> normalized content (only files that changed). */
  rewritten: Map<string, string>;
  /** Extra copybooks to write next to the sources (name -> content). */
  stubs: Map<string, string>;
  changes: Map<string, NormalizationChange[]>;
}

/** Normalizes every COBOL source/copybook in a bundle and works out which stub copybooks
 * must be supplied. Uploaded copybooks always win over stubs of the same name. */
export function normalizeBundle(files: { name: string; content: string }[]): BundleNormalization {
  const rewritten = new Map<string, string>();
  const changes = new Map<string, NormalizationChange[]>();
  const hoists = new Map<string, string>();
  let needsSupport = false;

  for (const file of files) {
    if (!/\.(cbl|cob|cpy)$/i.test(file.name)) continue;
    const result = normalizeCicsSource(file.content);
    result.hoists.forEach((pic, name) => hoists.set(name, pic));
    needsSupport ||= result.needsSupportCopybook;
    if (result.changes.length > 0) {
      rewritten.set(file.name, result.source);
      changes.set(file.name, result.changes);
    }
  }

  const present = new Set(
    files.map((f) => (f.name.split(/[/\\]/).pop() ?? f.name).replace(/\.[^.]+$/, '').toUpperCase()),
  );
  const stubs = new Map<string, string>();
  if (!present.has('DFHAID')) stubs.set('DFHAID.cpy', DFHAID_STUB);
  if (!present.has('DFHBMSCA')) stubs.set('DFHBMSCA.cpy', DFHBMSCA_STUB);
  if (needsSupport) stubs.set(`${SUPPORT_COPYBOOK_NAME}.cpy`, buildSupportCopybook(hoists));
  return { rewritten, stubs, changes };
}

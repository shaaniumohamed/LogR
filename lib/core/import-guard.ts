/**
 * Did this file come from the account it is being imported into?
 *
 * A trader with a live account and a demo has two exports in the same downloads
 * folder, named almost identically by the broker. Dropping the wrong one in is
 * an ordinary mistake with no symptom: the import succeeds, the numbers quietly
 * become a blend of two accounts, and nothing anywhere says so.
 *
 * Two checks, because one of them is not always available.
 */

/** How much stored history has to sit inside the file's dates before silence is suspicious. */
const MIN_OVERLAP = 10;

export interface MismatchInput {
  /** The account number stored against this journal, if it has ever been learnt. */
  storedLogin: string | null;
  /** The account number the file carries, if it carries one. */
  fileLogin: string | null;
  /** Fills already stored whose close falls inside the file's own date range. */
  existingInSpan: number;
  /** How many of the file's tickets this account already has. */
  matchingTickets: number;
}

export type Mismatch =
  | { kind: "login"; stored: string; found: string }
  | { kind: "overlap"; existingInSpan: number }
  | null;

/**
 * The account number settles it when both sides have one, and nothing else
 * needs to be considered — a different number is a different account.
 *
 * When it is absent, the tickets answer instead. Broker tickets are unique and
 * never reissued, so a file covering dates this account already has, that
 * shares NOT ONE ticket with it, cannot be the same account's history of those
 * same dates. A continuation file is not caught by this: later dates have no
 * stored fills inside them to disagree with. Nor is a re-import of the same
 * range: its tickets are already here, which is the whole signal.
 */
export function detectMismatch(i: MismatchInput): Mismatch {
  if (i.storedLogin && i.fileLogin && i.storedLogin !== i.fileLogin) {
    return { kind: "login", stored: i.storedLogin, found: i.fileLogin };
  }
  if (i.existingInSpan >= MIN_OVERLAP && i.matchingTickets === 0) {
    return { kind: "overlap", existingInSpan: i.existingInSpan };
  }
  return null;
}

/**
 * The account number out of a file name.
 *
 * Brokers put it there even when the file's own columns do not carry it —
 * `ExnessOrders_12345678.csv` and friends. Bounded at six digits so a date, a
 * year or a copy suffix like `(2)` cannot be mistaken for an account.
 */
export function accountNumberFromFilename(name: string): string | null {
  const runs = name.match(/\d{6,12}/g);
  if (!runs) return null;
  // A date stamp is a long digit run too, and brokers put those in file names
  // beside the account number. Only a run that really parses as a calendar date
  // is dropped, so an eight-digit ACCOUNT survives — which the obvious version
  // of this rule, "eight digits is a date", would have thrown away.
  const candidates = runs.filter((r) => !isDateStamp(r));
  if (!candidates.length) return null;
  // Longest wins, first occurrence breaks a tie: an account number is the
  // longest meaningful number in these names.
  return candidates.reduce((best, r) => (r.length > best.length ? r : best));
}

function isDateStamp(run: string): boolean {
  if (run.length !== 8) return false;
  const y = +run.slice(0, 4), m = +run.slice(4, 6), d = +run.slice(6, 8);
  return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Enough tickets to be sure, without sending twenty thousand of them to the
 * database. Taken from both ends: a file is most likely to overlap stored
 * history at one edge or the other, and a sample from the middle alone could
 * miss it.
 */
export function sampleTickets(tickets: string[], max = 400): string[] {
  if (tickets.length <= max) return [...new Set(tickets)];
  const half = Math.floor(max / 2);
  return [...new Set([...tickets.slice(0, half), ...tickets.slice(-half)])];
}

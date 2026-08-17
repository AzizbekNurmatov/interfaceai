export const LOOKUP_DELAY_MS = 500;

export const MOCK_CREDENTIALS = {
  username: "TELLER01",
  password: "PASSWORD",
} as const;

export interface MemberRecord {
  memberId: string;
  name: string;
  savingsBalance: string;
  checkingBalance: string;
  status: "Active" | "Locked";
  ssn: string;
}

export const ACTIVE_MEMBER: MemberRecord = {
  memberId: "12345",
  name: "JANE Q PUBLIC",
  savingsBalance: "$14,250.00",
  checkingBalance: "$3,120.50",
  status: "Active",
  ssn: "123-45-6789",
};

export type LookupOutcome =
  | { kind: "found"; member: MemberRecord }
  | { kind: "not_found"; message: "ERROR: Member record not found in core database." }
  | { kind: "locked"; message: "ERROR: Account locked due to compliance review." };

export function lookupMember(memberId: string): LookupOutcome {
  const id = memberId.trim();
  if (id === "12345") return { kind: "found", member: ACTIVE_MEMBER };
  if (id === "LOCKED") {
    return { kind: "locked", message: "ERROR: Account locked due to compliance review." };
  }
  return {
    kind: "not_found",
    message: "ERROR: Member record not found in core database.",
  };
}

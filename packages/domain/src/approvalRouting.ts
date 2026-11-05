export interface MatrixRule { docType: string; minPaise: number; maxPaise: number; approverRole: string }
export interface Maker { role: string; approvalLimitPaise: number }
export interface Route { approverRole: string; autoApprove: boolean; ruleFound: boolean }

/**
 * Delegation-of-authority routing. The matrix says which role signs a given amount.
 * If the maker already holds that role (or is super_admin) AND their own limit covers the amount, the doc auto-approves;
 * otherwise it waits for a different user with the approver role.
 */
export function routeApproval(docType: string, amountPaise: number, matrix: MatrixRule[], maker: Maker): Route {
  const rule = matrix.filter((r) => r.docType === docType && amountPaise >= r.minPaise && amountPaise <= r.maxPaise).sort((a, b) => a.minPaise - b.minPaise)[0];
  if (!rule) return { approverRole: 'super_admin', autoApprove: maker.role === 'super_admin', ruleFound: false };
  const mayAuto = (maker.role === rule.approverRole || maker.role === 'super_admin') && maker.approvalLimitPaise >= amountPaise;
  return { approverRole: rule.approverRole, autoApprove: mayAuto, ruleFound: true };
}
export function mayApprove(approver: Maker & { uid: string }, makerUid: string, approverRole: string, amountPaise: number): string | null {
  if (approver.uid === makerUid) return 'Maker-checker: you cannot approve your own document';
  if (approver.role !== approverRole && approver.role !== 'super_admin') return `Needs role ${approverRole}`;
  if (approver.approvalLimitPaise < amountPaise) return 'Amount exceeds your approval limit';
  return null;
}

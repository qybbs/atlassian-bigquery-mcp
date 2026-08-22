export const sanitizeLogString = (val: any): string => {
  if (val === undefined || val === null) return '';
  return String(val).replace(/[\r\n]/g, '');
};

export const writeAuditLog = (log: {
  requestId: string | number;
  userEmail: string;
  toolName: string;
  sql?: string;
  bytesEstimate?: number;
  tablesTouched?: string[];
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  denialReason?: string;
  error?: string;
  rowCount?: number;
}) => {
  const safeUserEmail = sanitizeLogString(log.userEmail);
  const safeToolName = sanitizeLogString(log.toolName);
  const safeStatus = sanitizeLogString(log.status);

  let severity: 'ERROR' | 'WARNING' | 'INFO' = 'INFO';
  if (log.status === 'FAILED') {
    severity = 'ERROR';
  } else if (log.status === 'REJECTED') {
    severity = 'WARNING';
  }

  const auditLogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    message: `[MCP AUDIT] ${safeUserEmail} executed ${safeToolName} - ${safeStatus}`,
    audit: {
      requestId: sanitizeLogString(log.requestId),
      userEmail: safeUserEmail,
      toolName: safeToolName,
      status: safeStatus,
      sql: log.sql ? sanitizeLogString(log.sql) : undefined,
      denialReason: log.denialReason ? sanitizeLogString(log.denialReason) : undefined,
      error: log.error ? sanitizeLogString(log.error) : undefined,
      bytesEstimate: log.bytesEstimate,
      rowCount: log.rowCount,
      tablesTouched: log.tablesTouched ? log.tablesTouched.map(t => sanitizeLogString(t)) : undefined,
    },
  };
  console.log(JSON.stringify(auditLogEntry));
};

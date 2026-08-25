export const sanitizeLogString = (val: any): string => {
  if (val === undefined || val === null) return '';
  return String(val).replace(/[\r\n]/g, '');
};

export const writeAuditLog = (log: {
  requestId: string | number;
  userEmail: string;
  toolName: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  denialReason?: string;
  error?: string;
  metadata?: Record<string, any>;
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
      denialReason: log.denialReason ? sanitizeLogString(log.denialReason) : undefined,
      error: log.error ? sanitizeLogString(log.error) : undefined,
      ...(log.metadata || {})
    },
  };
  console.log(JSON.stringify(auditLogEntry));
};

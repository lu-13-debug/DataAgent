const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError']);
export function buildDiagnostic(error: unknown, version: string, now = new Date()): string {
  return JSON.stringify({
    code: 'DA_UI_RENDER_FAILED',
    version: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? version : 'unknown',
    errorType: error instanceof Error && errorTypes.has(error.name) ? error.name : 'Error',
    timestamp: now.toISOString(),
  }, null, 2);
}

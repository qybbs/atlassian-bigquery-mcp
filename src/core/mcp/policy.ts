export class PolicyError extends Error {
  public metadata: Record<string, any>;
  constructor(message: string, metadata: Record<string, any> = {}) {
    super(message);
    this.name = 'PolicyError';
    this.metadata = metadata;
  }
}

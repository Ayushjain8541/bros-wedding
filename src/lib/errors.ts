export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(code);
    this.name = "DomainError";
  }
}

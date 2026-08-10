export type SearchFailurePhase =
  | "INPUT_VALIDATION"
  | "AUTH"
  | "TSGW_CONFIG"
  | "REQUEST"
  | "HTTP"
  | "PROTOCOL"
  | "UNEXPECTED"

export class TsgwSearchError extends Error {
  constructor(
    readonly phase: SearchFailurePhase,
    message: string,
  ) {
    super(message)
    this.name = "TsgwSearchError"
  }
}

export function formatSearchError(error: unknown): string {
  if (error instanceof TsgwSearchError) {
    return `[${error.phase}] ${error.message}`
  }

  return "[UNEXPECTED] TS Search failed unexpectedly."
}

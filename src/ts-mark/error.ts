import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "../shared/tsgw/constants.js"

export type MediaFailurePhase =
  | "INPUT_VALIDATION"
  | "TSGW_CONFIG"
  | "AUTH"
  | "HTTP"
  | "PROTOCOL"
  | "ARTIFACT_WRITE"
  | "TIMEOUT"
  | "CANCEL"

export class TsgwMediaError extends Error {
  constructor(
    readonly phase: MediaFailurePhase,
    message: string,
  ) {
    super(message)
    this.name = "TsgwMediaError"
  }
}

export function toolFailure(title: string, error: unknown) {
  const failure = error instanceof TsgwMediaError
    ? error
    : new TsgwMediaError("HTTP", `${TSGW_PROVIDER_LABEL} request failed. No retry was attempted.`)
  return {
    title,
    output: `[${failure.phase}] ${failure.message}`,
    metadata: {
      provider: TSGW_PROVIDER_ID,
      phase: failure.phase,
    },
  }
}

export function unavailableMediaResult(title: string) {
  return toolFailure(title, new TsgwMediaError("TSGW_CONFIG", "TSGW runtime provider configuration is unavailable."))
}

export const DAILY_TRANSITIONS = Object.freeze({
  TRIGGERED: ["LOCK_ACQUIRED", "ALREADY_COMPLETED", "FAILED"],
  LOCK_ACQUIRED: ["INPUT_VALIDATED", "INPUT_INVALID", "FAILED"],
  INPUT_VALIDATED: ["BROWSER_READY", "BROWSER_UNAVAILABLE", "FAILED"],
  BROWSER_READY: ["AUTHENTICATED", "USER_ATTENTION_REQUIRED", "FAILED"],
  AUTHENTICATED: ["QUERIES_RUNNING", "COMPLETED", "FAILED"],
  QUERIES_RUNNING: ["CARDS_CLASSIFIED", "PARTIAL_FAILURE", "USER_ATTENTION_REQUIRED", "FAILED"],
  CARDS_CLASSIFIED: ["DETAILS_EXTRACTED", "PARTIAL_FAILURE", "USER_ATTENTION_REQUIRED", "FAILED"],
  DETAILS_EXTRACTED: ["DISCOVERY_MATERIALIZED", "PARTIAL_FAILURE", "FAILED"],
  DISCOVERY_MATERIALIZED: ["SCREENING_COMPLETE", "PARTIAL_FAILURE", "FAILED"],
  SCREENING_COMPLETE: ["DOCUMENTS_COMPLETE", "COMPLETED", "PARTIAL_FAILURE", "FAILED"],
  DOCUMENTS_COMPLETE: ["COMPLETED", "PARTIAL_FAILURE", "FAILED"],
});

export const TERMINAL_STATES = new Set([
  "ALREADY_COMPLETED",
  "INPUT_INVALID",
  "BROWSER_UNAVAILABLE",
  "USER_ATTENTION_REQUIRED",
  "PARTIAL_FAILURE",
  "COMPLETED",
  "FAILED",
]);

export class DailyStateMachine {
  constructor(initialState = "TRIGGERED") {
    if (!(initialState in DAILY_TRANSITIONS) && !TERMINAL_STATES.has(initialState)) {
      throw new Error(`Unknown daily state: ${initialState}`);
    }
    this.state = initialState;
  }

  transition(nextState) {
    const allowed = DAILY_TRANSITIONS[this.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid transition from ${this.state} to ${nextState}`);
    }
    this.state = nextState;
    return this.state;
  }
}

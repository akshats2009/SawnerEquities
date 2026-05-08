export const DEFAULT_MAX_RISK_PCT = 0.01
export const HARD_MAX_RISK_PCT = 0.02
export const MIN_RAW_EDGE = 0.03
export const MIN_PERCENTAGE_EDGE = 6
export const MAX_ACCEPTABLE_SPREAD = 0.04
export const MIN_LIQUIDITY_QUALITY = 0.4
export const MIN_CONFIDENCE_SCORE = 70
export const MIN_TIME_REMAINING_MINUTES = 10
export const MIN_EDGE_TO_SPREAD_RATIO = 1.5
export const HIGH_CONFIDENCE_OVERSIZE_THRESHOLD = 88
export const MIN_EDGE_QUALITY_FOR_OVERSIZE = 0.8
export const EXTREME_REALIZED_VOLATILITY = 1.25
export const EPSILON = 1e-9

/** Reject trades when the diffusion model emitted more than this many warnings. */
export const MAX_PROBABILITY_WARNINGS_FOR_TRADE = 3

/** Model and market both near 50% with only a sliver of edge → treat as a coinflip. */
export const COINFLIP_MODEL_DISTANCE_FROM_FIFTY = 0.07
export const COINFLIP_IMPLIED_DISTANCE_FROM_FIFTY = 0.09
export const COINFLIP_MAX_ABS_RAW_EDGE = 0.028

/** Block "all-in" style concentration: proposed notional vs bankroll. */
export const ALL_IN_BANKROLL_FRACTION = 0.5

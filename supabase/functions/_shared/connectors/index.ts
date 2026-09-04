export * from './types.ts';
export * from './runner.ts';
export * from './noaa-weather.ts';

import { buildRegistry } from './runner.ts';
import { noaaWeatherAdapter } from './noaa-weather.ts';

/**
 * Adapters the platform ships.
 *
 * Sage Intacct, ADP and Trimble VisionLink implement the same `ConnectorAdapter`
 * interface and slot in here. They are not present because each needs that
 * vendor's credentials to be written against anything real, and an adapter
 * written against a guess at an API is worse than no adapter — it looks
 * finished. NOAA is here because it is verifiable today, on every commit,
 * by anyone.
 */
export const REGISTRY = buildRegistry([noaaWeatherAdapter]);

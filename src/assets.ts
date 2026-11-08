/**
 * SUNSMITH builds every visual procedurally (shaders + geometry), so the
 * IWSDK asset manifest is intentionally empty: zero downloads before the first
 * frame, which keeps cold start fast on Quest.
 */
import { defineAssets } from '@iwsdk/core';

export default defineAssets({});

import { expect, it, vi } from 'vitest';
import { perfPhases, perfRecord, perfTime, perfTimeAsync } from './perf-marks';

it('runs without retaining timing samples unless the Taro overlay is compiled in', async () => {
  perfPhases.clear();
  const run = vi.fn(() => 7);

  expect(perfTime('disabled', run)).toBe(7);
  expect(await perfTimeAsync('disabled-async', async () => 8)).toBe(8);
  perfRecord('disabled-record', 9);

  expect(run).toHaveBeenCalledOnce();
  expect(perfPhases.size).toBe(0);
});

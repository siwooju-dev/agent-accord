import {
  demoScenarios,
  type DemoScenario,
  type DemoScenarioKey,
} from '../mocks/scenarios';

const MOCK_LATENCY_MS = 80;

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export const mockClient = {
  async loadScenario(key: DemoScenarioKey): Promise<DemoScenario> {
    await wait(MOCK_LATENCY_MS);
    return demoScenarios[key];
  },
};

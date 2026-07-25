const { generateTripPlan } = require('../../src/services/gemini.service');

// Mock GoogleGenerativeAI to simulate API hangs
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => {
      return {
        getGenerativeModel: jest.fn().mockImplementation(() => {
          return {
            generateContent: jest.fn().mockImplementation(() => {
              // Return a promise that never resolves to simulate a hang
              return new Promise(() => {});
            })
          };
        })
      };
    })
  };
});

describe('Itinerary Generator - Bounded Time & Timeout Test', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should timeout each attempt, retry, and return null on persistent hang', async () => {
    const tripData = {
      source: 'Delhi',
      destination: 'Goa',
      startDate: '2026-07-20',
      endDate: '2026-07-25',
      budget: 20000,
      numTravelers: 2,
      groupType: 'friends',
      preferences: ['beach']
    };

    const planPromise = generateTripPlan(tripData, null, []);

    // We have 3 attempts.
    // Attempt 1: 15s timeout -> waits 1s delay
    // Attempt 2: 15s timeout -> waits 2s delay
    // Attempt 3: 15s timeout
    // Total time needed to advance is at least 15+1+15+2+15 = 48s.
    // We will advance in steps and flush the microtask queue to allow retries to execute.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(16000);
      // Flush microtasks
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    const plan = await planPromise;
    expect(plan).toBeNull();
  });
});

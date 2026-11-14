import { generateFixtures } from "./generate";

export { FIXTURE_AS_OF, HERO_CUSTOMER_NO, generateFixtures, type FixtureSet } from "./generate";
export { createRandom } from "./random";

/** The default, memoised demo data set. */
export const fixtures = generateFixtures();

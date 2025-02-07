// // Chai provides assertions (e.g. expect, assert)
import { expect } from "chai";
// // Sinon provides mocks, spies, stubs, etc. We use them to replace and control the behaviour of code
// // that is external to our test unit, or to verify how out test unit interfaces with external code.
import { assert, createSandbox, fake, SinonSpy } from "sinon";
import { comparePolygons as testUnit } from "./methods";
import { Match } from "./match";
import proxyquire from "proxyquire";

// We plug all our fakes, spies, etc into the system under test using a sandbox. This makes it
// easier to clean them up after each test.
const sandbox = createSandbox();

const fakeNodeGeocoder = sandbox.stub();

// We need to stub node-geocoder, which returns the geocoder constructor directly as
// module.exports). Sinon doesn't have a way to stub this (see what it can stub here
// https://sinonjs.org/how-to/stub-dependency/), so we need to use proxyquire.
const { comparePolygons } = proxyquire("./methods", {
  "node-geocoder": fakeNodeGeocoder,
}) as { comparePolygons: typeof testUnit };

const examplePoly = [
  [-1.4609501, 51.2205179],
  [-1.4611946, 51.2206139],
  [-1.4610909, 51.2204049],
  [-1.4609501, 51.2205179],
];

const exampleFarAwayPoly = [
  [-1.4985482, 51.1845143],
  [-1.5071717, 51.1771746],
  [-1.4900932, 51.1786055],
  [-1.4985482, 51.1845143],
];

// Cleanup that run after each 'it' testcase
afterEach(async () => {
  // Restore all fakes that were created https://sinonjs.org/releases/latest/sandbox/
  sandbox.restore();
});

describe("comparePolygons", () => {
  it("should return Match.Exact when oldCoords and newCoords are exact match", async () => {
    const result = await comparePolygons(1, 2, examplePoly, examplePoly);

    expect(result.match).to.equal(Match.Exact);
    expect(result.percentageIntersect).to.equal(100);
  });

  it("should return Match.ExactOffset when oldCoords and newCoords are exactly offset in lng/lat, by less than 1e-4 in each direction", async () => {
    const newCoords = examplePoly.map(([lng, lat]) => [lng + 9e-5, lat - 3e-6]);

    const result = await comparePolygons(1, 2, examplePoly, newCoords);

    expect(result.match).to.equal(Match.ExactOffset);
    expect(result.percentageIntersect).to.equal(100);
    expect(result.offsetStats).to.exist;
  });

  it("should return Match.Fail when oldCoords and newCoords are exactly offset, but by more than 1e-4", async () => {
    const newCoords = examplePoly.map(([lng, lat]) => [
      lng + 1e-5,
      lat - 1.1e-4,
    ]);

    const result = await comparePolygons(1, 2, examplePoly, newCoords);

    expect(result.match).to.equal(Match.Fail);
    expect(result.percentageIntersect).is.lessThan(100);
    expect(result.offsetStats).to.exist;
  });

  it("should return Match.HighOverlap when oldCoords and newCoords are over 98% overlapping", async () => {
    // Move the vertices slightly, in different amounts so that it's not exactly offset
    const newCoords = examplePoly.map(([lng, lat]) => [
      lng + Math.random() * 2e-6,
      lat - Math.random() * 2e-6,
    ]);
    newCoords[newCoords.length - 1] = newCoords[0]; // Ensure it's a valid closed polygon

    const result = await comparePolygons(1, 2, examplePoly, newCoords);

    expect(result.percentageIntersect).is.lessThan(100).and.is.greaterThan(95);
    expect(result.match).to.equal(Match.HighOverlap);
    expect(result.offsetStats).to.exist;
  });

  it("should return Match.Moved when coords have moved but the new location matches with the geocoded title address", async () => {
    // Stub the geocoder so it returns coordinates that match with exampleFarAwayPoly
    const exampleFarAwayPolyCenter = [-1.498632, 51.180847];
    fakeNodeGeocoder.returns({
      geocode: (address: string) => [
        {
          longitude: exampleFarAwayPolyCenter[0],
          latitude: exampleFarAwayPolyCenter[1],
        },
      ],
    });

    const result = await comparePolygons(
      1,
      2,
      examplePoly,
      exampleFarAwayPoly,
      undefined,
      "123 Fake St"
    );

    expect(result.match).to.equal(Match.Moved);
    expect(result.percentageIntersect).to.equal(0);
  });

  // Add more test cases for other scenarios...
});

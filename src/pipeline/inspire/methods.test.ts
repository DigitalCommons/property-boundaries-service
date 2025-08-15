// // Chai provides assertions (e.g. expect, assert)
import { expect } from "chai";
// // Sinon provides mocks, spies, stubs, etc. We use them to replace and control the behaviour of code
// // that is external to our test unit, or to verify how out test unit interfaces with external code.
import { createSandbox } from "sinon";
import { comparePolygons } from "./methods.js";
import { Match } from "./match.js";
import * as turf from "@turf/turf";

// We plug all our fakes, spies, etc into the system under test using a sandbox. This makes it
// easier to clean them up after each test.
const sandbox = createSandbox();

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
const exampleFarAwayPolyCenter = turf.center(turf.polygon([exampleFarAwayPoly]))
  .geometry.coordinates;

describe("comparePolygons", () => {
  afterEach(async () => {
    // Restore all fakes that were created https://sinonjs.org/releases/latest/sandbox/
    sandbox.restore();
  });

  context("oldCoords and newCoords are exact match", () => {
    it("should return Match.Exact", async () => {
      const result = await comparePolygons(1, 2, examplePoly, examplePoly);

      expect(result.match).to.equal(Match.Exact);
      expect(result.percentageIntersect).to.equal(100);
    });
  });

  context("oldCoords and newCoords are exactly offset", () => {
    it("should return Match.ExactOffset when offset is less than 1e-4 in each direction lng/lat", async () => {
      for (let i = 0; i < 10; i++) {
        const lngOffset = Math.random() * 2e-4 - 1e-4; // Random number between -1e-4 and 1e-4
        const latOffset = Math.random() * 2e-4 - 1e-4;

        const newCoords = examplePoly.map(([lng, lat]) => [
          lng + lngOffset,
          lat + latOffset,
        ]);

        const result = await comparePolygons(1, 2, examplePoly, newCoords);

        expect(result.match).to.equal(Match.ExactOffset);
        expect(result.percentageIntersect).to.equal(100);
        expect(result.offsetStats).to.exist;
      }
    });

    it("should return Match.Fail when offset is more than 1e-4 in each direction lng/lat", async () => {
      for (let i = 0; i < 10; i++) {
        // Random number with absolute value more than 1e-4 and less than 1e-3
        const lngOffset =
          (Math.random() * 9e-4 + 1e-4) * Math.sign(Math.random() - 0.5);
        const latOffset =
          (Math.random() * 9e-4 + 1e-4) * Math.sign(Math.random() - 0.5);

        const newCoords = examplePoly.map(([lng, lat]) => [
          lng + lngOffset,
          lat + latOffset,
        ]);

        const result = await comparePolygons(1, 2, examplePoly, newCoords);

        expect(result.match).to.equal(Match.Fail);
        expect(result.percentageIntersect).is.lessThan(100);
        expect(result.offsetStats).to.exist;
      }
    });
  });

  context("oldCoords and newCoords are not exactly offset but ", () => {
    context("oldCoords and newCoords are over 98% overlapping", () => {
      it("should return Match.HighOverlap", async () => {
        // Move the vertices slightly, in different amounts so that it's not exactly offset
        const newCoords = examplePoly.map(([lng, lat]) => [
          lng + Math.random() * 2e-6,
          lat - Math.random() * 2e-6,
        ]);
        newCoords[newCoords.length - 1] = newCoords[0]; // Ensure it's a valid closed polygon

        const result = await comparePolygons(1, 2, examplePoly, newCoords);

        expect(result.percentageIntersect)
          .is.lessThan(100)
          .and.is.greaterThan(95);
        expect(result.match).to.equal(Match.HighOverlap);
        expect(result.offsetStats).to.exist;
      });
    });

    context("oldCoords and newCoords are overlapping by less than 98%", () => {
      it("should return Match.Moved when the new location is < 50m from the geocoded title address", async () => {
        // Random coordinates that are less than 50m away from the center of exampleFarAwayPoly
        const getRandomCoordinates = () =>
          turf.destination(
            exampleFarAwayPolyCenter,
            Math.random() * 50,
            Math.random() * 360,
            { units: "meters" },
          ).geometry.coordinates;

        // Stub the geocoder to always return the above generated coordinates Sinon doesn't have a
        // way to stub this (see what it can stub here https://sinonjs.org/how-to/stub-dependency/),
        // so we need to inject it directly into the method
        const fakeGeocoder = {
          geocode: (address: string) => {
            const coords = getRandomCoordinates();
            return [{ longitude: coords[0], latitude: coords[1] }];
          },
        };

        for (let i = 0; i < 10; i++) {
          const result = await comparePolygons(
            1,
            2,
            examplePoly,
            exampleFarAwayPoly,
            undefined,
            "123 Fake St",
            fakeGeocoder,
          );

          expect(result.match).to.equal(Match.Moved);
        }
      });

      it("should return Match.Fail when the new location is > 50m from the geocoded title address", async () => {
        // Random coordinates that are > 50m and < 1km away from the center of exampleFarAwayPoly
        const getRandomCoordinates = () =>
          turf.destination(
            exampleFarAwayPolyCenter,
            Math.random() * 950 + 50,
            Math.random() * 360,
            { units: "meters" },
          ).geometry.coordinates;

        // Stub the geocoder to always return the above generated coordinates
        const fakeGeocoder = {
          geocode: (address: string) => {
            const coords = getRandomCoordinates();
            return [{ longitude: coords[0], latitude: coords[1] }];
          },
        };

        for (let i = 0; i < 10; i++) {
          const result = await comparePolygons(
            1,
            2,
            examplePoly,
            exampleFarAwayPoly,
            undefined,
            "123 Fake St",
            fakeGeocoder,
          );

          expect(result.match).to.equal(Match.Fail);
        }
      });

      it("should return Match.Fail when there is no associated title address", async () => {
        const result = await comparePolygons(
          1,
          2,
          examplePoly,
          exampleFarAwayPoly,
          // no title address
        );

        expect(result.match).to.equal(Match.Fail);
      });

      it("should return Match.Fail when geocoding of the title address fails", async () => {
        const fakeGeocoder = {
          geocode: (address: string) => {
            throw new Error("TEST: failed geocoding");
          },
        };

        const result = await comparePolygons(
          1,
          2,
          examplePoly,
          exampleFarAwayPoly,
          undefined,
          "123 Fake St",
          fakeGeocoder,
        );

        expect(result.match).to.equal(Match.Fail);
      });
    });
  });

  // Add more test cases for other scenarios...
});

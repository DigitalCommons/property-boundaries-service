"use strict";

export default {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      // land_ownerships
      await queryInterface.bulkInsert(
        "land_ownerships",
        [
          {
            title_no: "TEST-T1",
            tenure: "Freehold",
            property_address: "10 Example Rd",
            district: "WESTMINSTER",
            county: "GREATER LONDON",
            region: "LONDON",
            postcode: "SW1A 1AA",
            proprietor_name_1: "Westminster Council",
            company_registration_no_1: "WC000001",
            proprietor_category_1: "Local Authority",
            proprietor_1_address_1: "64 Victoria St, London",
            proprietor_uk_based: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            title_no: "TEST-T2",
            tenure: "Freehold",
            property_address: "20 Sample St",
            district: "CITY OF LONDON",
            county: "GREATER LONDON",
            region: "LONDON",
            postcode: "EC1A 1BB",
            proprietor_name_1: "Sample Holdings Ltd",
            company_registration_no_1: "SHL123456",
            proprietor_category_1: "Company",
            proprietor_1_address_1: "1 Fenchurch St, London",
            proprietor_uk_based: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          // Ownership-only (no polygon)
          {
            title_no: "TEST-T4",
            tenure: "Freehold",
            property_address: "40 Phantom Ln",
            district: "WESTMINSTER",
            county: "GREATER LONDON",
            region: "LONDON",
            postcode: "SW1A 2ZZ",
            proprietor_name_1: "Phantom Estates PLC",
            company_registration_no_1: "PEP987654",
            proprietor_category_1: "Company",
            proprietor_1_address_1: "2 Parliament St, London",
            proprietor_uk_based: true, 
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          // Simple single-parcel title
          {
            title_no: "TEST-T5",
            tenure: "Freehold",
            property_address: "50 New Place",
            district: "SOUTHWARK",
            county: "GREATER LONDON",
            region: "LONDON",
            postcode: "SE1 2AA",
            proprietor_name_1: "New Place Ltd",
            company_registration_no_1: "NPL555555",
            proprietor_category_1: "Company",
            proprietor_1_address_1: "5 Tower Bridge Rd, London",
            proprietor_uk_based: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        { transaction: t },
      );

      // land_ownership_polygons
      const polygonsInput = [
        {
          poly_id: 2000001,
          title_no: "TEST-T1",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.1286, 51.501],
                [-0.1279, 51.501],
                [-0.1279, 51.5016],
                [-0.1286, 51.5016],
                [-0.1286, 51.501],
              ],
            ],
          },
        },
        {
          poly_id: 2000002,
          title_no: "TEST-T1",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.1292, 51.5017],
                [-0.1286, 51.5017],
                [-0.1286, 51.5023],
                [-0.1292, 51.5023],
                [-0.1292, 51.5017],
              ],
            ],
          },
        },
        {
          poly_id: 2000003,
          title_no: "TEST-T2",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.105, 51.515],
                [-0.1044, 51.515],
                [-0.1044, 51.5156],
                [-0.105, 51.5156],
                [-0.105, 51.515],
              ],
            ],
          },
        },
        {
          poly_id: 2000004,
          title_no: "TEST-T3-NO-OWNERSHIP",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.14, 51.505],
                [-0.1394, 51.505],
                [-0.1394, 51.5056],
                [-0.14, 51.5056],
                [-0.14, 51.505],
              ],
            ],
          },
        },
        {
          poly_id: 2000005,
          title_no: "TEST-T5",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.0816, 51.504],
                [-0.0809, 51.504],
                [-0.0809, 51.5046],
                [-0.0816, 51.5046],
                [-0.0816, 51.504],
              ],
            ],
          },
        },
      ];

      const polygonsRows = polygonsInput.map((p) => ({
        poly_id: p.poly_id,
        title_no: p.title_no,
        geom: Sequelize.fn("ST_GeomFromGeoJSON", JSON.stringify(p.geometry)),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await queryInterface.bulkInsert("land_ownership_polygons", polygonsRows, {
        transaction: t,
      });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.bulkDelete(
        "land_ownership_polygons",
        { poly_id: [2000001, 2000002, 2000003, 2000004, 2000005] },
        { transaction: t },
      );
      await queryInterface.bulkDelete(
        "land_ownerships",
        { title_no: ["TEST-T1", "TEST-T2", "TEST-T4", "TEST-T5"] },
        { transaction: t },
      );
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};

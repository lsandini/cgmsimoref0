// api/nightscout.js
const fetch = require("node-fetch");
const logger = require("../utils/logger");

// Import functions from cgmsim library - using the same pattern as your reference script
const {
  downloads,
  uploadDeviceStatus,
  uploadTreatments,
} = require("@lsandini/cgmsim-lib");

/**
 * Get CGM entries from Nightscout
 * @param {string} baseUrl - Nightscout URL
 * @param {string} apiSecret - API secret for Nightscout
 * @param {number} count - Number of entries to retrieve
 * @returns {Promise<Array>} - CGM entries
 */
async function getEntries(baseUrl, apiSecret, count = 144) {
  try {
    logger.debug(`Fetching ${count} entries from Nightscout`);

    // Custom implementation to fetch the required number of entries
    const url = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const isHttps = url.startsWith("https");

    // Create a hash of the API secret
    const crypto = require("crypto");
    const hash = crypto.createHash("sha1");
    hash.update(apiSecret);
    const hashedSecret = hash.digest("hex");

    // Create headers with the hashed secret
    const headers = {
      "Content-Type": "application/json",
      "api-secret": hashedSecret,
    };

    // Create the HTTPS agent if needed
    const agent = isHttps
      ? new (require("https").Agent)({ rejectUnauthorized: false })
      : null;

    const endpoint = `${url}/api/v1/entries.json?count=${count}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      agent,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    logger.debug(`Received ${data.length} entries from Nightscout`);

    // Log a sample of the data
    if (data.length > 0) {
      logger.debug(`Sample entry: ${JSON.stringify(data[0])}`);
      logger.debug(
        `First few entries timestamps: ${data
          .slice(0, 5)
          .map((e) => e.dateString || new Date(e.date).toISOString())
          .join(", ")}`
      );
    }

    return data;
  } catch (error) {
    logger.error(`Error fetching entries from Nightscout: ${error.message}`);
    throw error;
  }
}

/**
 * Get treatments from Nightscout using library's downloads function
 * @param {string} baseUrl - Nightscout URL
 * @param {string} apiSecret - API secret for Nightscout
 * @param {number} count - Number of treatments to retrieve (not used with library function)
 * @returns {Promise<Array>} - Treatments
 */
async function getTreatments(baseUrl, apiSecret, count = 288) {
  try {
    logger.debug(
      `Fetching ${count} treatments from Nightscout using downloads()`
    );

    const data = await downloads(baseUrl, apiSecret);

    logger.info(
      `TREATMENTS COMPARISON: downloads() returned ${data.treatments.length} treatments vs requested ${count} treatments`
    );
    logger.debug(
      `Received ${data.treatments.length} treatments from Nightscout`
    );
    if (data.treatments.length > 0) {
      logger.debug(`Sample treatment: ${JSON.stringify(data.treatments[0])}`);
      logger.debug(
        `First few treatments timestamps: ${data.treatments
          .slice(0, 5)
          .map((t) => t.created_at || new Date(t.date || t.mills).toISOString())
          .join(", ")}`
      );
    }

    return data.treatments;
  } catch (error) {
    logger.error(`Error fetching treatments from Nightscout: ${error.message}`);
    throw error;
  }
}

/**
 * Get profile from Nightscout using library's downloads function
 * @param {string} baseUrl - Nightscout URL
 * @param {string} apiSecret - API secret for Nightscout
 * @returns {Promise<Object>} - Profile from Nightscout
 */
async function getProfile(baseUrl, apiSecret) {
  try {
    logger.debug("Fetching profile from Nightscout");

    const data = await downloads(baseUrl, apiSecret);

    if (data.profiles && data.profiles.length > 0) {
      logger.debug(`Successfully retrieved profile from Nightscout`);
      logger.debug(`Profile keys: ${Object.keys(data.profiles[0]).join(", ")}`);

      // Log store section if it exists
      if (data.profiles[0].store) {
        const storeKeys = Object.keys(data.profiles[0].store);
        logger.debug(`Profile store keys: ${storeKeys.join(", ")}`);

        // Log a sample profile if available
        if (storeKeys.length > 0) {
          const sampleProfileName = storeKeys[0];
          const sampleProfile = data.profiles[0].store[sampleProfileName];
          logger.debug(
            `Sample profile (${sampleProfileName}) keys: ${Object.keys(
              sampleProfile
            ).join(", ")}`
          );

          // Log some important profile values
          if (sampleProfile) {
            logger.debug(`DIA: ${sampleProfile.dia}`);
            logger.debug(
              `Basal settings: ${JSON.stringify(sampleProfile.basal)}`
            );
            logger.debug(`ISF settings: ${JSON.stringify(sampleProfile.sens)}`);
            logger.debug(
              `Carb ratio settings: ${JSON.stringify(sampleProfile.carbratio)}`
            );
            logger.debug(`Units: ${sampleProfile.units}`);
          }
        }
      }

      return data.profiles[0];
    } else {
      logger.warn("Empty or invalid profile returned from Nightscout");
      return null;
    }
  } catch (error) {
    logger.error(`Error fetching profile from Nightscout: ${error.message}`);
    throw error;
  }
}

/**
 * Upload treatments to Nightscout using library's uploadTreatments function
 * @param {string} baseUrl - Nightscout URL
 * @param {string} apiSecret - API secret for Nightscout
 * @param {Array|Object} treatments - Treatments to upload
 * @returns {Promise<Object>} - Response status
 */
async function handleTreatments(baseUrl, apiSecret, treatments) {
  try {
    // Handle both single treatment and arrays
    const treatmentsArray = Array.isArray(treatments)
      ? treatments
      : [treatments];

    logger.debug(
      `Uploading ${treatmentsArray.length} treatments to Nightscout`
    );
    logger.debug(
      `Treatments array type: ${typeof treatmentsArray}, isArray: ${Array.isArray(
        treatmentsArray
      )}`
    );

    if (treatmentsArray.length === 0) {
      return { success: true, count: 0 };
    }

    if (treatmentsArray.length > 0) {
      logger.debug(
        `Sample treatment being uploaded: ${JSON.stringify(treatmentsArray[0])}`
      );
    }

    // Process each treatment individually using library function
    const results = [];
    for (let i = 0; i < treatmentsArray.length; i++) {
      const treatment = treatmentsArray[i];

      logger.debug(`Treatment ${i + 1} type: ${typeof treatment}`);
      logger.debug(`Treatment ${i + 1} content: ${JSON.stringify(treatment)}`);

      // Ensure created_at is present
      if (!treatment.created_at) {
        treatment.created_at = new Date().toISOString();
        logger.debug(`Added created_at to treatment: ${treatment.created_at}`);
      }

      try {
        // Call library function for each treatment with correct params
        logger.debug(
          `Calling uploadTreatments with treatment eventType: ${treatment.eventType}`
        );

        // We simplified the library function, so only pass the first 3 params
        await uploadTreatments(treatment, baseUrl, apiSecret);
        logger.debug(`Successfully uploaded treatment ${i + 1}`);

        results.push({ success: true });
      } catch (uploadError) {
        logger.error(
          `Failed to upload treatment ${i + 1}: ${uploadError.message}`
        );
        logger.error(`Error stack: ${uploadError.stack}`);
        results.push({ success: false, error: uploadError.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.debug(
      `Successfully uploaded ${successCount} out of ${treatmentsArray.length} treatments to Nightscout`
    );

    return { success: successCount > 0, count: successCount, results };
  } catch (error) {
    logger.error(`Error in handleTreatments: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    throw error;
  }
}

/**
 * Upload device status to Nightscout using library's uploadDeviceStatus function
 * @param {string} baseUrl - Nightscout URL
 * @param {string} apiSecret - API secret for Nightscout
 * @param {Array} deviceStatuses - Device statuses to upload
 * @returns {Promise<Object>} - Response from Nightscout
 */
async function handleDeviceStatus(baseUrl, apiSecret, deviceStatuses) {
  try {
    logger.debug(
      `Uploading ${deviceStatuses.length} device statuses to Nightscout`
    );

    // Log detailed information about each deviceStatus
    deviceStatuses.forEach((status, index) => {
      logger.debug(`Device Status ${index + 1}:`, {
        totalIOB: status.openaps?.iob?.iob,
        basalIOB: status.openaps?.iob?.basaliob,
        bolusIOB: status.openaps?.iob?.bolusiob,
        pumpBasalIOB: status.openaps?.iob?.pumpBasalIOB,
        time: status.openaps?.iob?.time,
      });
    });

    // Process each device status using library function
    if (Array.isArray(deviceStatuses)) {
      if (deviceStatuses.length === 0) {
        logger.debug("No device statuses to upload");
        return { success: true, count: 0 };
      }

      const results = await Promise.all(
        deviceStatuses.map((status) =>
          uploadDeviceStatus(status, baseUrl, apiSecret)
        )
      );
      logger.debug(
        `Successfully uploaded ${deviceStatuses.length} device statuses to Nightscout`
      );
      return { success: true, count: deviceStatuses.length };
    } else {
      // Handle single device status
      await uploadDeviceStatus(deviceStatuses, baseUrl, apiSecret);
      logger.debug("Successfully uploaded device status to Nightscout");
      return { success: true, count: 1 };
    }
  } catch (error) {
    logger.error(
      `Error uploading device status to Nightscout: ${error.message}`
    );
    throw error;
  }
}

/**
 * Factory function to create a client with the given configuration, for backwards compatibility
 * @param {Object} config - Configuration object
 * @param {string} config.url - Nightscout URL
 * @param {string} config.apiSecret - API secret for Nightscout (in clear text)
 * @returns {Object} - Functions for interacting with Nightscout
 */
function createNightscoutClient(config) {
  logger.info(`Initializing Nightscout client for ${config.url}`);

  return {
    getEntries: (count) => getEntries(config.url, config.apiSecret, count),
    getTreatments: (count) =>
      getTreatments(config.url, config.apiSecret, count),
    uploadTreatments: (treatments) =>
      handleTreatments(config.url, config.apiSecret, treatments), // Use your wrapper
    getProfile: () => getProfile(config.url, config.apiSecret),
    uploadDeviceStatus: (deviceStatuses) =>
      handleDeviceStatus(config.url, config.apiSecret, deviceStatuses),
  };
}

module.exports = {
  createNightscoutClient,
  getEntries,
  getTreatments,
  getProfile,
  uploadDeviceStatus: handleDeviceStatus,
  uploadTreatments: handleTreatments,
};

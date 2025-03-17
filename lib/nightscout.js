const axios = require('axios');

class NightscoutClient {
  constructor(config) {
    this.baseUrl = config.url;
    this.apiSecret = config.apiSecret;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'API-SECRET': this.apiSecret,
        'Content-Type': 'application/json'
      }
    });
  }

  async getEntries(count = 288) { // 24 hours of 5-min CGM data
    try {
      const response = await this.client.get(`/api/v1/entries.json?count=${count}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching entries from Nightscout:', error.message);
      throw error;
    }
  }

  async getTreatments(count = 100) {
    try {
      const response = await this.client.get(`/api/v1/treatments.json?count=${count}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching treatments from Nightscout:', error.message);
      throw error;
    }
  }

  async uploadTreatments(treatments) {
    try {
      const response = await this.client.post('/api/v1/treatments', treatments);
      return response.data;
    } catch (error) {
      console.error('Error uploading treatments to Nightscout:', error.message);
      throw error;
    }
  }

  async getProfile() {
    try {
      const response = await this.client.get('/api/v1/profile.json');
      return response.data[0];
    } catch (error) {
      console.error('Error fetching profile from Nightscout:', error.message);
      throw error;
    }
  }

  async uploadDeviceStatus(deviceStatus) {
    try {
      const response = await this.client.post('/api/v1/devicestatus', deviceStatus);
      return response.data;
    } catch (error) {
      console.error('Error uploading device status to Nightscout:', error.message);
      throw error;
    }
  }
}

module.exports = NightscoutClient;
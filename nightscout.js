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

  async uploadDeviceStatus(deviceStatuses) {
    console.log('=== UPLOADING DEVICE STATUSES ===');
    console.log('Number of device statuses:', deviceStatuses.length);
    
    // Log detailed information about each deviceStatus
    deviceStatuses.forEach((status, index) => {
      console.log(`Device Status ${index + 1}:`, {
        fullIOBObject: JSON.stringify(status.openaps?.iob, null, 2),
        totalIOB: status.openaps?.iob?.iob,
        basalIOB: status.openaps?.iob?.basaliob,
        bolusIOB: status.openaps?.iob?.bolusiob,
        pumpBasalIOB: status.openaps?.iob?.pumpBasalIOB,
        time: status.openaps?.iob?.time
      });
    });
  
    try {
      const response = await this.client.post('/api/v1/devicestatus', deviceStatuses);
      console.log('Upload Response:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error uploading device status to Nightscout:', error.message);
      console.error('Full error:', error);
      throw error;
    }
  }

}

module.exports = NightscoutClient;
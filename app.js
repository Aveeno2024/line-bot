// test_simple.js
const axios = require('axios');

const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';

async function test() {
  // 測試即時觀測 API（台北站 46692）
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_AUTH_KEY}&format=JSON&StationId=46692`;
  
  try {
    const res = await axios.get(url);
    console.log('成功！', res.data.records?.Station[0]?.WeatherElement);
  } catch(e) {
    console.log('失敗:', e.response?.data || e.message);
  }
}

test();

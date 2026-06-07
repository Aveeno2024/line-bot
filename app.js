// test_cwa.js - 獨立測試
const axios = require('axios');

const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4'; // 請填入正確的金鑰

async function testCWA() {
  // 正確的 API 端點
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_AUTH_KEY}&format=JSON&StationId=46692`;
  
  console.log('測試中央氣象署 API...');
  console.log('URL:', url.replace(CWA_AUTH_KEY, '***HIDDEN***'));
  
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });
    
    console.log('\n✅ API 回應成功！');
    console.log('狀態:', response.data.success);
    
    if (response.data.success === 'true') {
      const station = response.data.records?.Station?.[0];
      if (station) {
        console.log('\n🌡️ 台北市天氣資料：');
        console.log(`   溫度: ${station.WeatherElement.AirTemperature}℃`);
        console.log(`   濕度: ${station.WeatherElement.RelativeHumidity}%`);
        console.log(`   觀測時間: ${station.ObserveTime}`);
      }
    } else {
      console.log('\n❌ API 失敗:', response.data);
    }
  } catch (error) {
    console.error('\n❌ 請求失敗:', error.message);
    if (error.response) {
      console.error('HTTP 狀態:', error.response.status);
      console.error('回應:', error.response.data);
    }
  }
}

testCWA();

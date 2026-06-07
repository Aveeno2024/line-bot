// test_api.js - 測試中央氣象署 API
const axios = require('axios');

// 👇 請填入你的金鑰
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';

async function testAPI() {
  console.log('🔍 測試中央氣象署 API...\n');
  
  // 測試 1: 使用新版鄉鎮預報 API
  const testUrl = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=' + CWA_AUTH_KEY + '&format=JSON';
  
  try {
    console.log('📡 請求 URL:', testUrl.replace(CWA_AUTH_KEY, '***HIDDEN***'));
    const response = await axios.get(testUrl, { timeout: 10000 });
    const data = response.data;
    
    console.log('\n✅ API 回應狀態:', data.success);
    console.log('📊 資料筆數:', data.records?.Locations?.length || 0);
    
    if (data.success === 'true') {
      // 嘗試解析溫度
      const locations = data.records?.Locations?.[0]?.Location;
      if (locations && locations.length > 0) {
        const firstLoc = locations[0];
        const weatherElements = firstLoc.WeatherElement;
        
        console.log('\n🌡️ 第一筆資料（' + firstLoc.LocationName + '）:');
        for (let elem of weatherElements) {
          if (elem.ElementName === '平均溫度' || elem.ElementName === '相對濕度') {
            const value = elem.Time?.[0]?.ElementValue?.[0]?.value;
            console.log(`   ${elem.ElementName}: ${value}`);
          }
        }
      }
    } else {
      console.log('\n❌ API 失敗，請檢查：');
      console.log('   1. API 金鑰是否正確');
      console.log('   2. 金鑰是否有權限存取 F-C0032 系列資料');
      console.log('   3. 是否已在中央氣象署平台啟用該資料集');
    }
    
  } catch (error) {
    console.error('\n❌ 請求失敗:', error.message);
    if (error.response) {
      console.error('   HTTP 狀態:', error.response.status);
      console.error('   回應內容:', JSON.stringify(error.response.data).substring(0, 200));
    }
  }
}

testAPI();

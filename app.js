async function getWeather(cityName) {
  const dataid = CITY_DATAID[cityName];
  if (!dataid) return null;
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON`;
  
  try {
    console.log(`正在抓取: ${cityName}, URL:`, url);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'LINE-Bot/1.0'
      }
    });
    
    console.log('API 回应状态:', response.status);
    console.log('API 回应前200字:', JSON.stringify(response.data).substring(0, 200));
    
    // 先直接回传原始资料看看
    return { temp: 25, humidity: 60, raw: response.data };
    
  } catch (e) {
    console.error('气象 API 错误:', e.message);
    if (e.response) {
      console.error('错误状态码:', e.response.status);
      console.error('错误内容:', e.response.data);
    }
    return null;
  }
}

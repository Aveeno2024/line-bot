const express = require('express');
const axios = require('axios');
const app = express();

// ==========================================
// ⚠️ 请填入你的中央气象署授权码 ⚠️
// ==========================================
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// 要测试的 dataid 列表
const DATAID_LIST = [
  { city: "基隆市", dataid: "F-D0047-001" },
  { city: "宜蘭縣", dataid: "F-D0047-003" },
  { city: "花蓮縣", dataid: "F-D0047-005" },
  { city: "臺東縣", dataid: "F-D0047-007" },
  { city: "屏東縣", dataid: "F-D0047-009" },
  { city: "雲林縣", dataid: "F-D0047-011" },
  { city: "嘉義縣", dataid: "F-D0047-013" },
  { city: "彰化縣", dataid: "F-D0047-015" },
  { city: "南投縣", dataid: "F-D0047-017" },
  { city: "苗栗縣", dataid: "F-D0047-019" },
  { city: "桃園市", dataid: "F-D0047-055" },
  { city: "臺中市", dataid: "F-D0047-059" },
  { city: "臺北市", dataid: "F-D0047-061" },
  { city: "新北市", dataid: "F-D0047-063" },
  { city: "臺南市", dataid: "F-D0047-065" },
  { city: "高雄市", dataid: "F-D0047-067" },
  { city: "金門縣", dataid: "F-D0047-089" },
  { city: "澎湖縣", dataid: "F-D0047-091" }
];

// 测试所有 dataid
app.get('/test-all', async (req, res) => {
  console.log('开始测试所有 dataid...');
  
  const results = [];
  
  for (let item of DATAID_LIST) {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${item.dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON`;
    
    try {
      console.log(`正在测试: ${item.city} (${item.dataid})`);
      const response = await axios.get(url, { timeout: 10000 });
      const data = response.data;
      
      if (data.success === "true") {
        const locations = data.records?.Locations;
        if (locations && locations.length > 0) {
          const locationName = locations[0].LocationsName;
          const result = {
            期望城市: item.city,
            dataid: item.dataid,
            实际返回城市: locationName,
            匹配: item.city === locationName ? "✅ 正确" : "❌ 错误"
          };
          results.push(result);
          console.log(`  ✅ 成功: ${locationName}`);
        } else {
          results.push({
            期望城市: item.city,
            dataid: item.dataid,
            实际返回城市: "无资料",
            匹配: "❌ 错误"
          });
          console.log(`  ❌ 无资料`);
        }
      } else {
        results.push({
          期望城市: item.city,
          dataid: item.dataid,
          实际返回城市: `API失败: ${data.success}`,
          匹配: "❌ 错误"
        });
        console.log(`  ❌ API失败`);
      }
    } catch (e) {
      results.push({
        期望城市: item.city,
        dataid: item.dataid,
        实际返回城市: `错误: ${e.message}`,
        匹配: "❌ 错误"
      });
      console.log(`  ❌ 错误: ${e.message}`);
    }
  }
  
  console.log('测试完成！');
  res.json({
    说明: "每个 dataid 实际返回的县市名称",
    结果: results
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`测试服务器已启动，端口: ${PORT}`);
  console.log(`请访问 https://你的网址.onrender.com/test-all`);
});

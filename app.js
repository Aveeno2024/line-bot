// 測試用簡化 API
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API 正常運作',
    time: new Date().toISOString()
  });
});

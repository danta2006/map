// 云函数：一次性初始化（建 feedback 集合），可以在开发者工具里手动调用一次
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const result = { env: process.env.TCB_ENV || '', created: [], existed: [] };
  try {
    await db.createCollection('feedback');
    result.created.push('feedback');
  } catch (e) {
    // 集合已存在时会抛错，忽略
    result.existed.push('feedback');
    result.message = String((e && e.errMsg) || e);
  }
  try {
    const { total } = await db.collection('feedback').count();
    result.feedbackCount = total;
  } catch (e) {
    result.feedbackCount = -1;
  }
  return result;
};
